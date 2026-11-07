// Real FFmpeg export check. Uses only a generated video and an isolated server.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const temp = mkdtempSync(join(artifacts, 'export-check-'));
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, EDIT_PORT: String(port), EDIT_PROJECTS_DIR: temp };
const backend = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
backend.stderr.on('data', (s) => { log = (log + s).slice(-4000); });
backend.stdout.on('data', () => {});
const api = async (path, body) => {
  const response = await fetch(base + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
};
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await fetch(`${base}/api/projects`).then((r) => r.ok).catch(() => false);
    if (ready || backend.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Server did not start: ${log}`);
  const source = join(temp, 'generated.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true });
  await api('/api/projects', { name: 'export-check' });
  const p = '/api/projects/export-check';
  await api(`${p}/import`, { path: source, role: 'source', analyze: false });
  const state = await api(p);
  const preflight = await api(`${p}/render/preflight?quality=preview`);
  assert.equal(preflight.ready, true);
  const stale = await fetch(base + `${p}/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quality: 'preview', expectedRev: state.rev + 1 }) });
  assert.equal(stale.status, 409);
  const submitted = await api(`${p}/render`, { quality: 'preview', expectedRev: state.rev });
  assert.equal(submitted.render.rev, state.rev);
  assert.equal(submitted.render.snapshotId, preflight.snapshotId);
  await api(`${p}/ops`, { ops: [{ op: 'trim', clipId: state.project.clips[0].id, out: 2 }] });
  let job;
  for (let i = 0; i < 6; i++) {
    job = await api(`/api/jobs/${submitted.job.id}?wait=10000`);
    if (['done', 'error', 'cancelled'].includes(job.status)) break;
  }
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.equal(job.result.rev, state.rev);
  assert.equal(job.result.snapshotId, preflight.snapshotId);
  assert.equal(job.result.duration, 4);
  const current = await api(p);
  assert.equal(current.project.clips[0].out, 2);
  const output = join(temp, 'export-check', job.result.output);
  const rendered = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', output], { windowsHide: true, encoding: 'utf8' }));
  assert.ok(Math.abs(Number(rendered.format.duration) - 4) < 0.1);
  assert.ok(rendered.streams.some((s) => s.codec_name === 'h264'));
  console.log(JSON.stringify({ passed: true, capturedRevision: job.result.rev, liveRevision: current.rev, renderedDuration: rendered.format.duration, liveDuration: 2, output: job.result.output, streams: rendered.streams }, null, 2));
} finally {
  if (backend.exitCode === null) {
    const stopped = new Promise((done) => backend.once('exit', done));
    backend.kill(); await stopped;
  }
  assert.equal(dirname(temp), artifacts);
  rmSync(temp, { recursive: true, force: true });
}
