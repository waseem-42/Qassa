// End-to-end MCP smoke check against an isolated, disposable project directory.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Ajv from 'ajv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts/qa/task15');
mkdirSync(artifacts, { recursive: true });
const temp = mkdtempSync(join(artifacts, 'mcp-check-'));
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const env = { ...process.env, EDIT_PORT: String(port), EDIT_DATA_DIR: temp, EDIT_PROJECTS_DIR: join(temp, 'projects') };
const backend = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
backend.stderr.on('data', (s) => { log = (log + s).slice(-4000); });
backend.stdout.on('data', () => {});
const client = new Client({ name: 'project-management-check', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'packages/mcp/src/index.ts'], cwd: root, env, stderr: 'pipe' });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.ok).catch(() => false);
    if (ready || backend.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Isolated server did not start: ${log}`);
  await client.connect(transport);
  const invoke = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.content.find((item) => item.type === 'text').text;
  };
  const tools = await client.listTools();
  const editSchema = tools.tools.find((t) => t.name === 'edit').inputSchema;
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(editSchema);
  assert.equal(validate({ project: 'mcp-check', ops: [{ op: 'restore_project', project: {} }] }), false);
  assert.equal(validate({ project: 'mcp-check', ops: [{ op: 'add_clip', free: true, clip: { trackId: 'overlay', mediaId: 'm', in: 0, out: 1 } }] }), true);
  assert.equal(validate({ project: 'mcp-check', ops: [{ op: 'update_clip', clipId: 'c', patch: { anim: { volume: [{ t: 'bad', v: 1 }] } } }] }), false);
  assert.equal(tools.tools.find((t) => t.name === 'render').inputSchema.properties.marked.type, 'boolean');
  for (const name of ['project_rename', 'project_trash', 'projects_trash_list', 'project_restore', 'checkpoint_create', 'checkpoint_restore', 'checkpoints_list', 'project_state', 'render_preflight']) assert.ok(tools.tools.some((t) => t.name === name), name);
  await invoke('project_create', { name: 'mcp-check' });
  const renamed = JSON.parse(await invoke('project_rename', { project: 'mcp-check', name: 'تجربة صانع محتوى' }));
  assert.equal(renamed.project, 'mcp-check');
  assert.equal(renamed.displayName, 'تجربة صانع محتوى');
  assert.equal(JSON.parse(await invoke('projects_list'))[0].displayName, renamed.displayName);
  const checkpoint = JSON.parse(await invoke('checkpoint_create', { project: 'mcp-check', label: 'قبل تجربة التعديلات' })).checkpoint;
  await invoke('project_rename', { project: 'mcp-check', name: 'اسم مؤقت' });
  const stale = await client.callTool({ name: 'checkpoint_restore', arguments: { project: 'mcp-check', id: checkpoint.id, expectedRev: renamed.rev } });
  assert.equal(stale.isError, true);
  const state = JSON.parse(await invoke('project_state', { project: 'mcp-check' }));
  assert.equal(state.project.name, 'اسم مؤقت');
  const recovered = JSON.parse(await invoke('checkpoint_restore', { project: 'mcp-check', id: checkpoint.id, expectedRev: state.rev }));
  assert.ok(recovered.safetyCheckpoint.id);
  assert.equal(JSON.parse(await invoke('project_state', { project: 'mcp-check' })).project.name, renamed.displayName);
  assert.equal(JSON.parse(await invoke('checkpoints_list', { project: 'mcp-check' })).length, 2);
  await invoke('edit', { project: 'mcp-check', ops: [{ op: 'set_marks', in: 25, out: 10 }] });
  assert.deepEqual(JSON.parse(await invoke('project_state', { project: 'mcp-check' })).project.settings.marks, { in: 10, out: 25 });
  assert.match(await invoke('project_summary', { project: 'mcp-check' }), /In=10 Out=25.*marked:true/);
  const preflight = JSON.parse(await invoke('render_preflight', { project: 'mcp-check', quality: 'preview' }));
  assert.equal(preflight.ready, false);
  assert.ok(preflight.blockers.length > 0);
  assert.deepEqual(preflight.resources.filter((r) => r.status === 'ready'), []);
  assert.equal(typeof preflight.resourceCounts, 'object');
  const source = join(temp, 'fixture.mp4');
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-y', source], { windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const imported = JSON.parse(await invoke('media_import', { project: 'mcp-check', path: source, wait: 50 }));
  assert.equal(typeof imported.jobId, 'string');
  assert.equal(imported.job.id, imported.jobId);
  assert.equal(imported.job.status, 'done');
  assert.ok(!imported.job.steps.includes('transcribe'));
  const noAnalysis = JSON.parse(await invoke('media_import', { project: 'mcp-check', path: source, analyze: false }));
  assert.equal(noAnalysis.jobId, null);
  await invoke('edit', { project: 'mcp-check', ops: [
    { op: 'add_clip', clip: { id: 'safe-a', trackId: 'overlay', mediaId: imported.media.id, in: 0, out: 2, start: 1 } },
    { op: 'add_clip', free: true, clip: { id: 'safe-b', trackId: 'V2', mediaId: imported.media.id, in: 0, out: 2, start: 2 } },
  ] });
  let placed = JSON.parse(await invoke('project_state', { project: 'mcp-check' }));
  assert.notEqual(placed.project.clips.find((c) => c.id === 'safe-a').trackId, placed.project.clips.find((c) => c.id === 'safe-b').trackId);
  await invoke('undo', { project: 'mcp-check' });
  const undone = JSON.parse(await invoke('project_state', { project: 'mcp-check' })).project;
  assert.ok(!undone.clips.some(c => c.id.startsWith('safe-')));
  assert.equal(undone.tracks.length, placed.project.tracks.length - 1);
  await invoke('redo', { project: 'mcp-check' });
  const overlap = await invoke('edit', { project: 'mcp-check', ops: [{ op: 'move', clipId: 'safe-b', trackId: 'V2', start: 1 }] });
  assert.match(overlap, /Overlap.*safe-a.*safe-b.*free:true/);
  await invoke('edit', { project: 'mcp-check', ops: [{ op: 'move', clipId: 'safe-b', start: 1, free: true }] });
  // Deliberate word-timing fixture: adjacent cut words and a 1.7s leading pause.
  const words = [{ i: 0, w: 'قبل', t0: .1, t1: .5 }, { i: 1, w: 'احذف', t0: 2.2, t1: 2.5 }, { i: 2, w: 'أطفالنا', t0: 2.5, t1: 3 }, { i: 3, w: 'بعد', t0: 3, t1: 3.4 }];
  const analysis = join(temp, 'projects/mcp-check/analysis', imported.media.id);
  mkdirSync(analysis, { recursive: true });
  writeFileSync(join(analysis, 'transcript.json'), JSON.stringify({ mediaId: imported.media.id, language: 'ar', model: 'deterministic-test-fixture', words, segments: [] }));
  const cut = await invoke('edit', { project: 'mcp-check', ops: [{ op: 'cut_words', mediaId: imported.media.id, from: 1, to: 2 }] });
  assert.match(cut, /pause across cut shortened.*0.12s/);
  assert.doesNotMatch(await invoke('check_cuts', { project: 'mcp-check', images: false }), /cuts inside/);
  await invoke('captions', { project: 'mcp-check' });
  const review = await invoke('review', { project: 'mcp-check' });
  assert.match(review, /^review: /);
  assert.ok(tools.tools.some((t) => t.name === 'review'));
  const slim =JSON.parse(await invoke('render_preflight', { project: 'mcp-check' }));
  const verbose = JSON.parse(await invoke('render_preflight', { project: 'mcp-check', verbose: true }));
  assert.ok(verbose.resources.some((r) => r.kind === 'font' && r.status === 'ready'));
  assert.ok(slim.resourceCounts.font > 0);
  assert.ok(slim.resources.every((r) => r.status !== 'ready'));
  assert.deepEqual(slim.warnings, verbose.warnings);
  assert.equal(slim.rev, verbose.rev);
  assert.equal(slim.ready, true);
  const deleted = JSON.parse(await invoke('project_trash', { project: 'mcp-check' }));
  assert.equal(JSON.parse(await invoke('projects_list')).length, 0);
  assert.equal(JSON.parse(await invoke('projects_trash_list'))[0].id, deleted.trashed.id);
  const restored = JSON.parse(await invoke('project_restore', { id: deleted.trashed.id }));
  assert.equal(restored.project, 'mcp-check');
  assert.equal(restored.displayName, renamed.displayName);
  assert.equal(JSON.parse(await invoke('projects_trash_list')).length, 0);
  const missing = await client.callTool({ name: 'project_trash', arguments: { project: 'missing' } });
  assert.equal(missing.isError, true);
  assert.equal(JSON.parse(await invoke('checkpoints_list', { project: 'mcp-check' })).length, 2);
  console.log('PASS: MCP discovery/schema refs, create, Unicode rename, checkpoints, marks, import job/wait/no Whisper, free add/move, immediate overlap warning, adjacent-word cuts/pause notice/check_cuts, linked captions, slim/verbose preflight, trash/restore/errors.');
} finally {
  await client.close();
  if (backend.exitCode === null) {
    const stopped = new Promise((done) => backend.once('exit', done));
    backend.kill();
    await stopped;
  }
  // The only deleted tree is the unique directory this script created above.
  assert.equal(dirname(temp), artifacts);
  rmSync(temp, { recursive: true, force: true });
}
