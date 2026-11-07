import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { OpError, Project } from '@edit/shared';
import { ZodError } from 'zod';
import { Store, type ChangeEvent } from '../src/store.ts';
import { Jobs } from '../src/jobs.ts';
import { Checkpoints, registerCheckpoints } from '../src/checkpoints.ts';
import { registerProjectManagement } from '../src/project-management.ts';

const uuid = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('node:crypto', async (original) => {
  const actual = await original<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => uuid.value ?? actual.randomUUID() };
});

const workspace = mkdtempSync(join(tmpdir(), 'edit-checkpoints-test-'));
let root: string, store: Store, jobs: Jobs, checkpoints: Checkpoints, app: FastifyInstance | undefined;
beforeEach(() => {
  root = mkdtempSync(join(workspace, 'projects-'));
  store = new Store(root, { watch: false });
  jobs = new Jobs();
  checkpoints = new Checkpoints(store, jobs);
  store.create('film');
  store.mutate('film', (p) => {
    p.media.push({ id: 'm', path: 'source/original.mp4', name: 'original', role: 'source', kind: 'video', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true, analyzed: [] });
  });
  store.apply('film', [{ op: 'add_clip', clip: { id: 'c', mediaId: 'm', trackId: 'V1', in: 0, out: 60 } }]);
  writeFileSync(join(root, 'film/source/original.mp4'), Buffer.from([0, 1, 42, 255]));
});
afterEach(async () => { uuid.value = undefined; await app?.close(); app = undefined; await store.close(); });
afterAll(() => {
  const rel = relative(resolve(tmpdir()), resolve(workspace));
  if (!rel.startsWith('edit-checkpoints-test-') || isAbsolute(rel) || rel.includes('..')) throw new Error('unsafe test cleanup');
  rmSync(workspace, { recursive: true, force: true });
});

async function api() {
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof OpError || err instanceof ZodError ? 400 : (err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message }));
  await app.register(fastifyStatic, { root, prefix: '/files/', decorateReply: false, dotfiles: 'deny' });
  await app.register(fastifyMultipart);
  registerProjectManagement(app, store, jobs);
  registerCheckpoints(app, store, jobs);
  return app;
}

const savedFile = (id: string) => join(root, 'film/.checkpoints', `${id}.json`);

describe('durable project checkpoints', () => {
  it('creates an immutable Unicode-labeled snapshot without editing the project or history', () => {
    const projectBytes = readFileSync(join(root, 'film/project.json'));
    const history = store.history('film');
    const changes: ChangeEvent[] = [];
    store.on('change', (event) => changes.push(event));
    const metadata = checkpoints.create('film', '  قبل القص: الحلقة ٢  ');
    expect(metadata).toMatchObject({ label: 'قبل القص: الحلقة ٢', sourceRev: history.rev, kind: 'manual' });
    expect(store.history('film')).toEqual(history);
    expect(changes).toEqual([]);
    expect(readFileSync(join(root, 'film/project.json'))).toEqual(projectBytes);
    const bytes = readFileSync(savedFile(metadata.id));
    store.apply('film', [{ op: 'cut_range', mediaId: 'm', t0: 10, t1: 20 }]);
    expect(readFileSync(savedFile(metadata.id))).toEqual(bytes);
    expect(JSON.parse(bytes.toString()).project).toEqual(JSON.parse(projectBytes.toString()));
    expect(readdirSync(join(root, 'film/.checkpoints'))).toEqual([`${metadata.id}.json`]);
  });

  it('persists checkpoints and can restore them after a fresh Store/server lifetime', async () => {
    const original = structuredClone(store.get('film').project);
    const metadata = checkpoints.create('film', 'Original');
    store.apply('film', [{ op: 'cut_range', mediaId: 'm', t0: 15, t1: 40 }]);
    await store.close();
    store = new Store(root, { watch: false });
    checkpoints = new Checkpoints(store, jobs);
    expect(checkpoints.list('film')).toEqual([metadata]);
    const result = checkpoints.restore('film', metadata.id, 0);
    expect(result.project).toEqual(original);
    expect(result.rev).toBe(1);
    expect(checkpoints.list('film')).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(root, 'film/project.json'), 'utf8'))).toEqual(original);
  });

  it('creates a durable pre-restore copy, emits the new revision, and supports undo/redo', () => {
    const original = structuredClone(store.get('film').project);
    const first = checkpoints.create('film', 'Before editing');
    store.apply('film', [{ op: 'cut_range', mediaId: 'm', t0: 10, t1: 20 }, { op: 'rename_project', name: 'New title' }]);
    const edited = structuredClone(store.get('film').project), history = store.history('film');
    const events: ChangeEvent[] = [];
    store.on('change', (event) => events.push(event));
    const result = checkpoints.restore('film', first.id, history.rev);
    expect(result).toMatchObject({ project: original, rev: history.rev + 1, restoredCheckpointId: first.id, history: { undo: history.undo + 1, redo: 0 }, safetyCheckpoint: { kind: 'before_restore', label: 'قبل استعادة: Before editing', sourceRev: history.rev } });
    expect(events).toEqual([{ name: 'film', project: original, rev: history.rev + 1, author: 'checkpoint' }]);
    expect(JSON.parse(readFileSync(savedFile(result.safetyCheckpoint.id), 'utf8')).project).toEqual(edited);
    store.undo('film');
    expect(store.get('film').project).toEqual(edited);
    store.redo('film');
    expect(store.get('film').project).toEqual(original);
    const fromSafety = checkpoints.restore('film', result.safetyCheckpoint.id, store.get('film').rev);
    expect(fromSafety.project).toEqual(edited);
  });

  it('preserves original and newly imported media files while restoring saved source IDs and paths', () => {
    const originalBytes = readFileSync(join(root, 'film/source/original.mp4'));
    const snapshot = checkpoints.create('film', 'Original');
    writeFileSync(join(root, 'film/source/new.mp4'), 'new untouched media');
    store.mutate('film', (p) => p.media.push({ ...p.media[0], id: 'new', path: 'source/new.mp4', name: 'new' }));
    const result = checkpoints.restore('film', snapshot.id, store.get('film').rev);
    expect(result.project.media.map((media) => [media.id, media.path])).toEqual([['m', 'source/original.mp4']]);
    expect(readFileSync(join(root, 'film/source/original.mp4'))).toEqual(originalBytes);
    expect(readFileSync(join(root, 'film/source/new.mp4'), 'utf8')).toBe('new untouched media');
    expect(existsSync(join(root, 'film'))).toBe(true);
  });

  it('keeps automatic safety labels readable and within the label limit', () => {
    const snapshot = checkpoints.create('film', 'أ'.repeat(120));
    const result = checkpoints.restore('film', snapshot.id, store.get('film').rev);
    expect(result.safetyCheckpoint.label).toBe(`قبل استعادة: ${snapshot.label}`.slice(0, 120));
    expect(result.safetyCheckpoint.label).toHaveLength(120);
    expect(result.safetyCheckpoint.label).not.toContain(snapshot.id);
  });

  it('rejects stale revisions before creating a safety copy or changing the live state', () => {
    const snapshot = checkpoints.create('film', 'Original');
    const rev = store.get('film').rev;
    store.apply('film', [{ op: 'rename_project', name: 'Someone else edited' }]);
    const before = structuredClone(store.get('film').project), history = store.history('film');
    expect(() => checkpoints.restore('film', snapshot.id, rev)).toThrow('revision changed');
    expect(checkpoints.list('film')).toEqual([snapshot]);
    expect(store.get('film').project).toEqual(before);
    expect(store.history('film')).toEqual(history);
    expect(() => store.restoreProject('film', before, rev)).toThrow('revision changed');
  });

  it('rejects queued/running jobs, allowing a restore only after completion', async () => {
    const snapshot = checkpoints.create('film', 'Original');
    let finish!: () => void;
    const job = jobs.add('render', 'film', 'test', () => new Promise<void>((resolve) => { finish = resolve; }));
    expect(() => checkpoints.restore('film', snapshot.id, store.get('film').rev)).toThrow('queued or running');
    await Promise.resolve();
    expect(job.status).toBe('running');
    expect(() => checkpoints.restore('film', snapshot.id, store.get('film').rev)).toThrow('queued or running');
    expect(checkpoints.list('film')).toEqual([snapshot]);
    finish();
    await jobs.wait(job.id, 1000);
    expect(checkpoints.restore('film', snapshot.id, store.get('film').rev).restoredCheckpointId).toBe(snapshot.id);
  });

  it('blocks restore while an import request body is arriving before a job can be registered', async () => {
    const snapshot = checkpoints.create('film', 'Original'), server = await api();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    server.addHook('onRequest', async (req) => { if (req.routeOptions.url === '/api/projects/:name/import') started(); });
    server.post('/api/projects/:name/import', async () => {
      writeFileSync(join(root, 'film/source/new.mp4'), 'imported bytes');
      store.mutate('film', (p) => p.media.push({ ...p.media[0], id: 'new', path: 'source/new.mp4', name: 'new' }));
      return { ok: true };
    });
    const body = new PassThrough();
    const importing = server.inject({ method: 'POST', url: '/api/projects/film/import', headers: { 'content-type': 'application/json' }, payload: body }).then((response) => response);
    body.write('{"path":"unfinished');
    await entered;
    expect(jobs.hasActive('film')).toBe(false);
    const restore = () => server.inject({ method: 'POST', url: `/api/projects/film/checkpoints/${snapshot.id}/restore`, payload: { expectedRev: store.get('film').rev } });
    expect((await restore()).statusCode).toBe(409);
    expect(checkpoints.list('film')).toEqual([snapshot]);
    body.end('"}');
    expect((await importing).statusCode).toBe(200);
    expect((await restore()).statusCode).toBe(200);
    expect(readFileSync(join(root, 'film/source/new.mp4'), 'utf8')).toBe('imported bytes');
  });

  it('blocks restore during multipart upload, then preserves its added asset bytes on restore', async () => {
    const snapshot = checkpoints.create('film', 'Original'), server = await api();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    server.post('/api/projects/:name/upload', async (req) => {
      for await (const file of req.files()) {
        started();
        await pipeline(file.file, createWriteStream(join(root, 'film/source/new.mp4')));
      }
      store.mutate('film', (p) => p.media.push({ ...p.media[0], id: 'new', path: 'source/new.mp4', name: 'new' }));
      return { ok: true };
    });
    const body = new PassThrough();
    const uploading = server.inject({ method: 'POST', url: '/api/projects/film/upload', headers: { 'content-type': 'multipart/form-data; boundary=testboundary' }, payload: body }).then((response) => response);
    body.write('--testboundary\r\nContent-Disposition: form-data; name="file"; filename="new.mp4"\r\nContent-Type: application/octet-stream\r\n\r\nfirst chunk');
    await entered;
    expect(jobs.hasActive('film')).toBe(false);
    const restore = () => server.inject({ method: 'POST', url: `/api/projects/film/checkpoints/${snapshot.id}/restore`, payload: { expectedRev: store.get('film').rev } });
    expect((await restore()).statusCode).toBe(409);
    body.end(' last chunk\r\n--testboundary--\r\n');
    expect((await uploading).statusCode).toBe(200);
    expect((await restore()).statusCode).toBe(200);
    expect(store.get('film').project.media.map((media) => media.id)).toEqual(['m']);
    expect(readFileSync(join(root, 'film/source/new.mp4'), 'utf8')).toBe('first chunk last chunk');
  });

  it('rejects corrupt/schema-invalid/foreign snapshots without changing project or creating safety copies', () => {
    const metadata = checkpoints.create('film', 'Original'), path = savedFile(metadata.id);
    const snapshot = JSON.parse(readFileSync(path, 'utf8')), before = structuredClone(store.get('film').project), history = store.history('film');
    for (const bad of ['{invalid', JSON.stringify({ ...snapshot, projectId: 'other-folder' }), JSON.stringify({ ...snapshot, project: { ...snapshot.project, clips: 'invalid' } }), JSON.stringify({ ...snapshot, project: { ...snapshot.project, createdAt: 'different-project' } })]) {
      writeFileSync(path, bad);
      expect(() => checkpoints.restore('film', metadata.id, history.rev)).toThrow();
      expect(store.get('film').project).toEqual(before);
      expect(store.history('film')).toEqual(history);
      expect(readdirSync(join(root, 'film/.checkpoints'))).toEqual([`${metadata.id}.json`]);
    }
    writeFileSync(path, JSON.stringify(snapshot));
    expect(checkpoints.list('film')).toEqual([metadata]);
  });

  it('ignores incomplete and malformed files in listings', () => {
    const metadata = checkpoints.create('film', 'Original');
    writeFileSync(join(root, 'film/.checkpoints/.partial.tmp'), '{');
    writeFileSync(join(root, 'film/.checkpoints/not-a-uuid.json'), '{}');
    writeFileSync(join(root, 'film/.checkpoints/10000000-0000-4000-8000-000000000000.json'), '{invalid');
    expect(checkpoints.list('film')).toEqual([metadata]);
  });

  it('never replaces an immutable snapshot when publication collides', () => {
    uuid.value = '10000000-0000-4000-8000-000000000000';
    const metadata = checkpoints.create('film', 'Keep me'), bytes = readFileSync(savedFile(metadata.id));
    expect(() => checkpoints.create('film', 'Do not replace')).toThrow();
    expect(readFileSync(savedFile(metadata.id))).toEqual(bytes);
    expect(readdirSync(join(root, 'film/.checkpoints'))).toEqual([`${metadata.id}.json`]);
  });

  it('refuses checkpoint directory links, linked snapshots, and traversal IDs', () => {
    const outside = mkdtempSync(join(workspace, 'outside-')), dir = join(root, 'film/.checkpoints');
    writeFileSync(join(outside, 'precious.txt'), 'untouched');
    symlinkSync(outside, dir, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => checkpoints.create('film', 'No links')).toThrow(/links|junctions/);
    expect(() => checkpoints.list('film')).toThrow(/links|junctions/);
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('untouched');
    unlinkSync(dir);
    const metadata = checkpoints.create('film', 'Original'), path = savedFile(metadata.id);
    const linkedDir = join(workspace, `linked-snapshot-${metadata.id}`);
    mkdirSync(linkedDir);
    // A directory junction with a .json name works without Windows symlink privileges.
    unlinkSync(path);
    symlinkSync(linkedDir, path, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => checkpoints.restore('film', metadata.id, store.get('film').rev)).toThrow(/links|junctions/);
    unlinkSync(path);
    expect(() => checkpoints.restore('film', '../outside', store.get('film').rev)).toThrow('invalid checkpoint ID');
  });

  it('publishes restored project JSON atomically without updating memory/history if replacement fails', () => {
    const original = structuredClone(store.get('film').project);
    store.apply('film', [{ op: 'rename_project', name: 'Edited' }]);
    const edited = structuredClone(store.get('film').project), history = store.history('film');
    const file = join(root, 'film/project.json'), backup = join(root, 'film/.backup-project.json');
    renameSync(file, backup);
    mkdirSync(file); // force atomic replacement failure, preserving the original bytes separately
    expect(() => store.restoreProject('film', original, history.rev)).toThrow();
    expect(store.get('film').project).toEqual(edited);
    expect(store.history('film')).toEqual(history);
    expect(readdirSync(join(root, 'film')).some((name) => name.startsWith('.project-'))).toBe(false);
    rmdirSync(file);
    renameSync(backup, file);
    expect(Project.parse(JSON.parse(readFileSync(file, 'utf8')))).toEqual(edited);
  });

  it('requires the checkpoint transaction instead of allowing replacement through ordinary ops', () => {
    const original = structuredClone(store.get('film').project), history = store.history('film');
    expect(() => store.apply('film', [{ op: 'restore_project', project: original }])).toThrow('checkpoint restore API');
    expect(store.history('film')).toEqual(history);
    expect(store.get('film').project).toEqual(original);
  });

  it('exposes the API contract, validates inputs, and hides internal files from static serving', async () => {
    const server = await api();
    for (const label of ['', ' ', 'x'.repeat(121), 'bad\nlabel']) {
      expect((await server.inject({ method: 'POST', url: '/api/projects/film/checkpoints', payload: { label } })).statusCode).toBe(400);
    }
    expect((await server.inject('/api/projects/missing/checkpoints')).statusCode).toBe(404);
    const created = await server.inject({ method: 'POST', url: '/api/projects/film/checkpoints', payload: { label: 'Original' } });
    expect(created.statusCode).toBe(201);
    const checkpoint = created.json().checkpoint;
    expect((await server.inject('/api/projects/film/checkpoints')).json()).toEqual([checkpoint]);
    for (const segment of ['.checkpoints', '%2echeckpoints']) expect((await server.inject(`/files/film/${segment}/${checkpoint.id}.json`)).statusCode).not.toBe(200);
    const url = `/api/projects/film/checkpoints/${checkpoint.id}/restore`;
    for (const payload of [{}, { expectedRev: -1 }, { expectedRev: '2' }, { expectedRev: 0.5 }]) {
      expect((await server.inject({ method: 'POST', url, payload })).statusCode).toBe(400);
    }
    expect((await server.inject({ method: 'POST', url, payload: { expectedRev: 0 } })).statusCode).toBe(409);
    const unknown = await server.inject({ method: 'POST', url: '/api/projects/film/checkpoints/10000000-0000-4000-8000-000000000001/restore', payload: { expectedRev: store.get('film').rev } });
    expect(unknown.statusCode).toBe(404);
    const restored = await server.inject({ method: 'POST', url, payload: { expectedRev: store.get('film').rev } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ restoredCheckpointId: checkpoint.id, safetyCheckpoint: { kind: 'before_restore' }, project: { name: 'film' }, history: { redo: 0 } });
  });
});
