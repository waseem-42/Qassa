import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Clip, Media, OpError, Project, defaultTracks } from '@edit/shared';
import { compile, fileKey, FFMPEG, runPlan } from '@edit/render';
import { exportPreflight, projectSnapshotId, registerExportRoutes, renderOutput, type RenderSnapshot } from '../src/export-preflight.ts';
import { Store } from '../src/store.ts';
import { Jobs } from '../src/jobs.ts';

const workspace = mkdtempSync(join(tmpdir(), 'edit-export-test-'));
let root: string, dir: string, store: Store, jobs: Jobs, app: FastifyInstance | undefined;
beforeEach(() => {
  root = mkdtempSync(join(workspace, 'case-'));
  store = new Store(root, { watch: false });
  store.create('stable-id');
  dir = store.dir('stable-id');
  jobs = new Jobs();
});
afterEach(async () => { await app?.close(); app = undefined; await store.close(); });
afterAll(() => {
  const rel = relative(resolve(tmpdir()), resolve(workspace));
  if (!rel.startsWith('edit-export-test-') || isAbsolute(rel) || rel.includes('..')) throw new Error('unsafe test cleanup');
  rmSync(workspace, { recursive: true, force: true });
});
const put = (path: string, data = 'fixture') => { const file = join(dir, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); return file; };
it('warns about existing free-track overlaps while retaining export support', () => {
  const p = fixture();
  p.clips.push(Clip.parse({ id: 'a', mediaId: 'm', trackId: 'V2', start: 0, in: 0, out: 1.5 }), Clip.parse({ id: 'b', mediaId: 'm', trackId: 'V2', start: 1, in: 0, out: 1 }));
  const result = exportPreflight(p, 1, dir);
  expect(result.ready).toBe(true); expect(result.warnings.some((w) => w.code === 'overlapping_clips')).toBe(true);
  p.clips.find((c) => c.id === 'b')!.start = 1.5;
  expect(exportPreflight(p, 1, dir).warnings.some((w) => w.code === 'overlapping_clips')).toBe(false);
});
it('warns about overlapping caption clips on the same track, including legacy captions without word links', () => {
  const p = fixture(); p.tracks.push({ ...defaultTracks().find((t) => t.kind === 'text')!, id: 'CAP', name: 'كابشن' });
  p.clips.push(Clip.parse({ id: 'cap1', trackId: 'CAP', text: 'أول', start: .1, in: 0, out: 1.2 }), Clip.parse({ id: 'cap2', trackId: 'CAP', text: 'ثان', start: 1, in: 0, out: .5 }));
  expect(exportPreflight(p, 1, dir).warnings.some((w) => w.code === 'overlapping_captions')).toBe(true);
  p.clips.find((c) => c.id === 'cap2')!.start = 1.3;
  expect(exportPreflight(p, 1, dir).warnings.some((w) => w.code === 'overlapping_captions')).toBe(false);
});
function fixture() {
  put('source/a.mp4');
  const p = Project.parse({
    name: 'اسم ظاهر / مستقل', createdAt: '2026-10-29', tracks: defaultTracks(),
    settings: { aspect: '1:1', resolution: 64, fps: 24 },
    media: [{ id: 'm', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 2, width: 64, height: 64, fps: 24 }],
    clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 2 }],
  });
  store.mutate('stable-id', (next) => Object.assign(next, p));
  return store.get('stable-id').project;
}
async function api(renderer: Parameters<typeof registerExportRoutes>[3] = async (snapshot) => ({ duration: snapshot.project.clips[0].out })) {
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof OpError || err instanceof z.ZodError ? 400 : (err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message }));
  registerExportRoutes(app, store, jobs, renderer);
  return app;
}
const renderUrl = '/api/projects/stable-id/render';

describe('static export readiness', () => {
  it('reviews the selected export aspect without changing the project or checked revision', async () => {
    fixture();
    store.apply('stable-id', [{ op: 'add_text', text: 'عنوان', start: 0, duration: 2, style: { x: .5, y: .86 } }]);
    const server = await api(), before = structuredClone(store.get('stable-id'));
    const url = '/api/projects/stable-id/render/preflight?quality=final';
    const normal = (await server.inject({ url })).json();
    const vertical = (await server.inject({ url: url + '&aspect=9:16' })).json();
    expect(normal.review.some((f: { code: string }) => f.code === 'unsafe_area')).toBe(false);
    expect(vertical.review.some((f: { code: string }) => f.code === 'unsafe_area')).toBe(true);
    expect(vertical.rev).toBe(normal.rev); expect(vertical.snapshotId).toBe(normal.snapshotId);
    expect(store.get('stable-id')).toEqual(before);
    expect((await server.inject({ url: url + '&aspect=invalid' })).statusCode).toBe(400);
  });
  it('allows an audio spine and ignores visual LUTs on sound-only clips', () => {
    const p = fixture();
    p.media[0].kind = 'audio'; p.media[0].hasAudio = true;
    expect(exportPreflight(p, 1, dir).ready).toBe(true);
    p.media[0].kind = 'video'; p.clips[0].picture = { off: true, fit: 'fill', bars: 'black', crop: { l: 0, r: 0, t: 0, b: 0 }, rotate: 0, opacity: 1, flipX: false, flipY: false };
    p.settings.defaultGrade = { lut: 'missing.cube', lutMix: 1, contrast: 1, exposure: 0, gamma: 1, saturation: 1, temperature: 6500 };
    expect(exportPreflight(p, 1, dir).ready).toBe(true);
  });
  it('checks only used media, keeps stable folder paths after display-name changes, and fingerprints state', () => {
    const p = fixture();
    p.media.push(Media.parse({ id: 'unused', path: 'source/missing.mp4', role: 'broll', kind: 'video', name: 'unused' }));
    const result = exportPreflight(p, 7, dir);
    expect(result).toMatchObject({ ready: true, rev: 7, quality: 'final', snapshotId: projectSnapshotId(p) });
    expect(result.resources).toEqual([{ kind: 'media', path: 'source/a.mp4', status: 'ready', clipId: 'c', mediaId: 'm' }]);
    const next = structuredClone(p); next.settings.resolution = 128;
    expect(projectSnapshotId(next)).not.toBe(result.snapshotId);
  });

  it('blocks an empty main track and unresolved track/media links', () => {
    expect(exportPreflight(store.get('stable-id').project, 0, dir).blockers.map((i) => i.code)).toContain('empty_project');
    const p = fixture(); p.clips[0].mediaId = 'missing';
    p.clips.push(Clip.parse({ id: 'orphan', trackId: 'absent', mediaId: 'm', start: 0, in: 0, out: 1 }));
    expect(exportPreflight(p, 1, dir).blockers.map((i) => i.code)).toEqual(expect.arrayContaining(['missing_media_reference', 'unknown_track']));
    p.tracks = p.tracks.filter((t) => t.id !== 'V1');
    expect(exportPreflight(p, 1, dir).blockers.map((i) => i.code)).toContain('missing_main_track');
  });

  it('blocks missing sources and invalid source ranges without probing or launching the file', () => {
    const p = fixture(); p.media[0].path = 'source/absent.mp4'; p.clips[0].out = 8;
    const result = exportPreflight(p, 1, dir);
    expect(result.ready).toBe(false);
    expect(result.blockers.map((i) => i.code)).toEqual(expect.arrayContaining(['missing_media', 'source_range']));
  });

  it('does not require hidden overlays or muted audio, but includes clips beyond V1', () => {
    const p = fixture();
    p.tracks.push({ ...p.tracks.find((t) => t.id === 'V2')!, id: 'V3', hidden: false });
    p.tracks.find((t) => t.id === 'V2')!.hidden = true;
    p.tracks.find((t) => t.id === 'A2')!.muted = true;
    p.clips.push(...[
      { id: 'hidden', trackId: 'V2', mediaId: 'absent', start: 0, in: 0, out: 1 },
      { id: 'muted', trackId: 'A2', mediaId: 'absent', start: 0, in: 0, out: 1 },
      { id: 'late', trackId: 'V3', mediaId: 'absent', start: 5, in: 0, out: 1 },
    ].map((c) => Clip.parse(c)));
    expect(exportPreflight(p, 1, dir).blockers).toContainEqual(expect.objectContaining({ code: 'missing_media_reference', clipId: 'late' }));
    p.clips = p.clips.filter((c) => c.id !== 'late');
    expect(exportPreflight(p, 1, dir).ready).toBe(true);
  });

  it('checks graphic entry pages and effective LUTs but lets notes, suggestions, fonts and browser issues warn', () => {
    const p = fixture();
    p.settings.defaultGrade = { lut: 'luts/look.cube', lutMix: 1, exposure: 0, contrast: 1, saturation: 1, gamma: 1, temperature: 6500 };
    p.clips.push(Clip.parse({ id: 'graphic', trackId: 'V2', graphic: 'graphics/card', start: 0, in: 0, out: 1 }));
    p.notes.push({ id: 'n', at: 0, text: 'review', author: 'user', status: 'open' });
    p.suggestions.push({ id: 's', mediaId: 'm', t0: 0, t1: 0.2, reason: 'silence', author: 'analysis' });
    p.settings.theme.font = 'Unknown Custom Font';
    let result = exportPreflight(p, 3, dir, 'final', { fonts: [], browser: null });
    expect(result.blockers.map((i) => i.code)).toEqual(expect.arrayContaining(['missing_lut', 'missing_graphic']));
    put('graphics/card/index.html', '<div>card</div>'); put('luts/look.cube');
    result = exportPreflight(p, 3, dir, 'final', { fonts: [], browser: null });
    expect(result.ready).toBe(true);
    expect(result.warnings.map((i) => i.code)).toEqual(expect.arrayContaining(['open_notes', 'pending_suggestions', 'custom_font', 'font_files', 'render_browser']));
    expect(result.resources.find((r) => r.path === 'Unknown Custom Font')?.status).toBe('unverified');
  });

  it('checks library graphics against the library root and blocks traversal and junction escapes', () => {
    const p = fixture(), library = join(root, 'library');
    mkdirSync(join(library, 'title'), { recursive: true }); writeFileSync(join(library, 'title/index.html'), '<p>title</p>');
    p.clips.push(Clip.parse({ id: 'g', trackId: 'V2', graphic: 'lib/title', start: 0, in: 0, out: 1 }));
    expect(exportPreflight(p, 1, dir, 'final', { graphicsDir: library }).ready).toBe(true);
    p.clips[1].graphic = 'lib/../../secret';
    expect(exportPreflight(p, 1, dir, 'final', { graphicsDir: library }).blockers.map((i) => i.code)).toContain('missing_graphic');
    symlinkSync(library, join(dir, 'graphics/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    p.clips[1].graphic = 'graphics/escape/title';
    expect(exportPreflight(p, 1, dir).blockers.map((i) => i.code)).toContain('missing_graphic');
  });

  it('allows preview with a valid proxy when original is missing, but final requires the original', () => {
    const p = fixture(); p.media[0].path = 'source/absent.mp4'; p.media[0].proxy = 'analysis/m/proxy.mp4';
    put('analysis/m/proxy.mp4');
    const preview = exportPreflight(p, 1, dir, 'preview');
    expect(preview.ready).toBe(true);
    expect(preview.warnings.map((i) => i.code)).toContain('missing_original');
    expect(exportPreflight(p, 1, dir, 'final').ready).toBe(false);
  });
});

describe('render request state and output safety', () => {
  it('captures marked exports from the checked project revision and can undo a range deletion in one step', async () => {
    fixture();
    const server = await api();
    store.apply('stable-id', [{ op: 'set_marks', in: .25, out: 1.75 }]);
    const response = await server.inject({ method: 'POST', url: renderUrl, payload: { marked: true, expectedRev: store.get('stable-id').rev } });
    expect(response.statusCode).toBe(200);
    expect(response.json().render.range).toEqual([.25, 1.75]);
    store.apply('stable-id', [{ op: 'delete_range', start: .25, end: 1.75 }, { op: 'set_marks', in: null, out: null }]);
    expect(store.get('stable-id').project.clips.reduce((sum, c) => sum + c.out - c.in, 0)).toBe(.5);
    store.undo('stable-id');
    expect(store.get('stable-id').project.settings.marks).toEqual({ in: .25, out: 1.75 });
    expect(store.get('stable-id').project.clips[0].out).toBe(2);
  });
  it('rejects stale revisions and preflight blockers before creating a job', async () => {
    const p = fixture(), server = await api();
    const report = (await server.inject(`${renderUrl}/preflight`)).json();
    expect(report).toMatchObject({ ready: true, rev: store.get('stable-id').rev, snapshotId: projectSnapshotId(p) });
    store.apply('stable-id', [{ op: 'rename_project', name: 'عنوان جديد' }]);
    const stale = await server.inject({ method: 'POST', url: renderUrl, payload: { expectedRev: report.rev } });
    expect(stale.statusCode).toBe(409); expect(stale.json().code).toBe('stale_revision');
    store.apply('stable-id', [{ op: 'delete', clipId: 'c' }]);
    const empty = await server.inject({ method: 'POST', url: renderUrl, payload: {} });
    expect(empty.statusCode).toBe(409); expect(empty.json().code).toBe('export_not_ready');
    expect(jobs.list()).toHaveLength(0);
  });

  it('warns on malformed optional transcript analysis without blocking otherwise valid media', async () => {
    fixture();
    store.apply('stable-id', [{ op: 'split', clipId: 'c', at: 1 }]);
    put('analysis/m/transcript.json', '{ broken json');
    const server = await api();
    const report = await server.inject(`${renderUrl}/preflight`);
    expect(report.statusCode).toBe(200);
    expect(report.json().ready).toBe(true);
    expect(report.json().warnings.map((w: { code: string }) => w.code)).toContain('cut_check_unavailable');
    const queued = await server.inject({ method: 'POST', url: renderUrl, payload: { expectedRev: report.json().rev } });
    expect(queued.statusCode).toBe(200);
    expect((await jobs.wait(queued.json().job.id, 3000))?.status).toBe('done');
  });

  it('captures a deep snapshot before queueing and returns its revision in the result', async () => {
    fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    jobs.add('analysis', 'stable-id', 'hold queue', async () => { await gate; return {}; });
    let observed: RenderSnapshot | undefined;
    const queuedEvents: unknown[] = [];
    jobs.on('job', (job) => { if (job.kind === 'render' && job.status === 'queued') queuedEvents.push(structuredClone(job.render)); });
    const server = await api(async (snapshot) => { observed = snapshot; return { duration: snapshot.project.clips[0].out }; });
    const before = structuredClone(store.get('stable-id'));
    const response = await server.inject({ method: 'POST', url: renderUrl, payload: { quality: 'final', expectedRev: before.rev } });
    expect(response.statusCode).toBe(200);
    const queued = response.json();
    expect(queuedEvents).toEqual([queued.render]);
    store.apply('stable-id', [{ op: 'trim', clipId: 'c', out: 1 }, { op: 'set_settings', patch: { resolution: 128 } }]);
    store.mutate('stable-id', (next) => { next.media[0].name = 'changed'; });
    release();
    const done = await jobs.wait(queued.job.id, 3000);
    expect(done?.status).toBe('done');
    expect(observed?.project).toEqual(before.project);
    expect(observed?.dir).toBe(dir);
    expect(observed?.name).toBe('stable-id');
    expect(done?.result).toMatchObject({ duration: 2, rev: before.rev, snapshotId: projectSnapshotId(before.project), output: queued.render.output });
  });

  it('uses original on missing preview proxy without editing stored state', async () => {
    fixture(); store.mutate('stable-id', (p) => { p.media[0].proxy = 'analysis/m/missing.mp4'; });
    let observed: RenderSnapshot | undefined;
    const server = await api(async (snapshot) => { observed = snapshot; return {}; });
    const response = await server.inject({ method: 'POST', url: renderUrl, payload: { quality: 'preview' } });
    expect(response.statusCode).toBe(200);
    expect((await jobs.wait(response.json().job.id, 3000))?.status).toBe('done');
    expect(observed?.project.media[0].proxy).toBeUndefined();
    expect(store.get('stable-id').project.media[0].proxy).toBe('analysis/m/missing.mp4');
  });

  it('reserves explicit names, releases cancelled jobs, and gives every default request a unique name', async () => {
    fixture(); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    jobs.add('analysis', 'stable-id', 'hold', async () => { await gate; return {}; });
    const server = await api();
    const one = await server.inject({ method: 'POST', url: renderUrl, payload: { output: 'renders/custom.mp4' } });
    const conflict = await server.inject({ method: 'POST', url: renderUrl, payload: { output: 'renders/custom.mp4' } });
    expect(conflict.statusCode).toBe(409);
    jobs.cancel(one.json().job.id);
    const again = await server.inject({ method: 'POST', url: renderUrl, payload: { output: 'renders/custom.mp4' } });
    expect(again.statusCode).toBe(200);
    const a = (await server.inject({ method: 'POST', url: renderUrl, payload: {} })).json();
    const b = (await server.inject({ method: 'POST', url: renderUrl, payload: {} })).json();
    expect(a.render.output).not.toBe(b.render.output);
    expect(a.render.output).toMatch(/^renders\/preview-r\d+-[\da-f-]+\.mp4$/);
    release();
    await jobs.wait(b.job.id, 3000);
  });

  it('export settings: a chosen name numbered when taken, another frame/rate on the private copy, captions as SRT', async () => {
    fixture();
    store.apply('stable-id', [
      { op: 'add_track', track: { id: 'CAP', kind: 'text', name: 'كابشن' } },
      { op: 'add_text', trackId: 'CAP', text: 'أهلًا', start: 0.5, duration: 1 },
    ]);
    put('renders/قصتي - شورتس.mp4');
    let observed: RenderSnapshot | undefined;
    const server = await api(async (snapshot) => { observed = snapshot; return {}; });
    const res = await server.inject({ method: 'POST', url: renderUrl, payload: { quality: 'final', export: { fileName: 'قصتي - شورتس', aspect: '9:16', resolution: 1080, fps: 60, captions: 'srt', range: [0.25, 1.75] } } });
    expect(res.statusCode).toBe(200);
    const { render } = res.json();
    expect(render.output).toBe('renders/قصتي - شورتس (2).mp4');
    expect(render.srt).toBe('renders/قصتي - شورتس (2).srt');
    expect(render.range).toEqual([0.25, 1.75]);
    await jobs.wait(res.json().job.id, 3000);
    expect(observed?.project.settings).toMatchObject({ aspect: '9:16', resolution: 1080, fps: 60 });
    expect(observed?.project.tracks.find((t) => t.id === 'CAP')?.hidden).toBe(true); // not burnt in
    expect(store.get('stable-id').project.settings).toMatchObject({ aspect: '1:1', resolution: 64, fps: 24 }); // the project is untouched
    expect(readFileSync(join(dir, render.srt), 'utf8')).toBe('1\n00:00:00,250 --> 00:00:01,250\nأهلًا\n');
    const audio = (await server.inject({ method: 'POST', url: renderUrl, payload: { export: { fileName: 'صوت', format: 'mp3' } } })).json();
    expect(audio.render.output).toBe('renders/صوت.mp3');
    expect((await server.inject({ method: 'POST', url: renderUrl, payload: { export: { range: [5, 9] } } })).statusCode).toBe(400);
    await jobs.wait(audio.job.id, 3000);
  });

  it('rejects malformed requests, unsafe outputs, existing files and junction destinations', async () => {
    fixture(); const server = await api();
    for (const payload of [{ quality: 'invalid' }, { expectedRev: -1 }, { expectedRev: 1.2 }, { output: 'source/a.mp4' }, { output: 'renders/../a.mp4' }, { output: 'C:/outside.mp4' }, { output: 'renders/a.mp4:stream.mp4' }, { output: 'renders/NUL.mp4' }]) {
      expect((await server.inject({ method: 'POST', url: renderUrl, payload })).statusCode).toBe(400);
    }
    put('renders/existing.mp4');
    expect((await server.inject({ method: 'POST', url: renderUrl, payload: { output: 'renders/existing.mp4' } })).statusCode).toBe(409);
    const outside = join(root, 'outside'); mkdirSync(outside);
    symlinkSync(outside, join(dir, 'renders/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => renderOutput(dir, 'renders/escape/a.mp4')).toThrow('links');
    expect(jobs.list()).toHaveLength(0);
  });

  it('refuses an output created externally while its render was queued', async () => {
    fixture(); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    jobs.add('analysis', 'stable-id', 'hold', async () => { await gate; return {}; });
    let calls = 0;
    const server = await api(async () => { calls++; return {}; });
    const queued = (await server.inject({ method: 'POST', url: renderUrl, payload: { output: 'renders/claimed.mp4' } })).json();
    put('renders/claimed.mp4', 'keep me'); release();
    expect((await jobs.wait(queued.job.id, 3000))?.status).toBe('error');
    expect(calls).toBe(0);
    expect(readFileSync(join(dir, 'renders/claimed.mp4'), 'utf8')).toBe('keep me');
  });

  it('renders a tiny fixture from its queued snapshot after the live edit changes', async () => {
    fixture();
    const generated = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'source/a.mp4')], { windowsHide: true });
    expect(generated.status, generated.stderr?.toString()).toBe(0);
    store.mutate('stable-id', (p) => { p.media[0].hasAudio = true; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    jobs.add('analysis', 'stable-id', 'hold', async () => { await gate; return {}; });
    const server = await api(async ({ project, dir: folder, quality, output }, ctx) => {
      const plan = compile(project, { quality, output, nvenc: false, fileKey: fileKey(folder) });
      const out = await runPlan(plan, folder, () => {}, ctx.signal);
      return { output: out, duration: plan.duration };
    });
    const queued = (await server.inject({ method: 'POST', url: renderUrl, payload: { quality: 'final' } })).json();
    store.apply('stable-id', [{ op: 'trim', clipId: 'c', out: 0.5 }]);
    release();
    const done = await jobs.wait(queued.job.id, 15000);
    expect(done?.status, done?.error).toBe('done');
    const result = done?.result as { output: string; duration: number; snapshotId: string };
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', join(dir, result.output)], { encoding: 'utf8', windowsHide: true });
    expect(probe.status, probe.stderr).toBe(0);
    const metadata = JSON.parse(probe.stdout);
    expect(Number(metadata.format.duration)).toBeCloseTo(2, 1);
    expect(metadata.streams[0]).toMatchObject({ width: 64, height: 64 });
    expect(result.snapshotId).toBe(queued.render.snapshotId);
  }, 20000);
});
