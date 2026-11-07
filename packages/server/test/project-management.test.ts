import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { get as httpGet } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { OpError } from '@edit/shared';
import { ZodError } from 'zod';
import { Store } from '../src/store.ts';
import { Jobs } from '../src/jobs.ts';
import { ProjectManagement, registerProjectManagement } from '../src/project-management.ts';

const workspace = mkdtempSync(join(tmpdir(), 'edit-project-management-test-'));
let store: Store, jobs: Jobs, manager: ProjectManagement, root: string;
let app: FastifyInstance | undefined;
beforeEach(() => {
  root = mkdtempSync(join(workspace, 'projects-'));
  store = new Store(root, { watch: false });
  jobs = new Jobs();
  manager = new ProjectManagement(store, jobs);
});
afterEach(async () => { await app?.close(); app = undefined; await store.close(); });
afterAll(() => {
  const rel = relative(resolve(tmpdir()), resolve(workspace));
  if (!rel.startsWith('edit-project-management-test-') || isAbsolute(rel) || rel.includes('..')) throw new Error('unsafe test cleanup');
  rmSync(workspace, { recursive: true, force: true });
});

async function api() {
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof OpError || err instanceof ZodError ? 400 : (err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message }));
  await app.register(fastifyMultipart);
  await app.register(fastifyStatic, { root, prefix: '/files/', decorateReply: false, dotfiles: 'deny' });
  registerProjectManagement(app, store, jobs);
  app.get('/api/projects', async () => store.list());
  app.get<{ Params: { name: string } }>('/api/projects/:name', async (req) => manager.view(req.params.name));
  return app;
}

describe('recoverable project management', () => {
  it('keeps a real project named trash readable beside the .trash API namespace', async () => {
    store.create('trash');
    store.create('film');
    const entry = manager.delete('film');
    const server = await api();
    const project = await server.inject('/api/projects/trash');
    expect(project.statusCode).toBe(200);
    expect(project.json()).toMatchObject({ project: { name: 'trash' }, rev: 0, history: { undo: 0, redo: 0 } });
    const deleted = await server.inject('/api/projects/.trash');
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual([entry]);
    expect(() => store.create('.trash')).toThrow('invalid project name');
    const restored = await server.inject({ method: 'POST', url: `/api/projects/.trash/${entry.id}/restore` });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ name: 'film', project: { name: 'film' } });
    expect((await server.inject('/api/projects/trash')).json().project.name).toBe('trash');
  });

  it('renames through ops and undo/redo without changing folder IDs or media bytes', async () => {
    store.create('stable-id');
    const bytes = Buffer.from([0, 1, 7, 255]);
    writeFileSync(join(root, 'stable-id/source/original.mp4'), bytes);
    const notices: string[] = [];
    store.on('projects', () => notices.push('projects'));
    const server = await api();
    const renamed = await server.inject({ method: 'PATCH', url: '/api/projects/stable-id', payload: { name: '  عنوان / الحلقة: ٢  ' } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ project: { name: 'عنوان / الحلقة: ٢' }, rev: 1, history: { undo: 1, redo: 0 } });
    expect(store.list()[0]).toMatchObject({ name: 'stable-id', displayName: 'عنوان / الحلقة: ٢' });
    store.undo('stable-id');
    expect(store.list()[0].displayName).toBe('stable-id');
    store.redo('stable-id');
    expect(notices).toHaveLength(3);
    expect(readFileSync(join(root, 'stable-id/source/original.mp4'))).toEqual(bytes);
    expect(existsSync(join(root, 'عنوان / الحلقة: ٢'))).toBe(false);
  });

  it('moves every project file, reloads caches, and persists trash across restart', async () => {
    store.create('film');
    store.apply('film', [{ op: 'rename_project', name: 'فيلم' }]);
    const contents = new Map([
      ['source/original.mp4', Buffer.from([255, 0, 42])], ['refs/ref.bin', Buffer.from('reference')],
      ['renders/result.mp4', Buffer.from('render')], ['graphics/card/index.html', Buffer.from('<p>card</p>')],
    ]);
    for (const [file, bytes] of contents) { mkdirSync(join(root, 'film', file, '..'), { recursive: true }); writeFileSync(join(root, 'film', file), bytes); }
    mkdirSync(join(root, 'film/analysis/m'), { recursive: true });
    const transcript = JSON.stringify({ mediaId: 'm', language: 'ar', words: [] });
    writeFileSync(join(root, 'film/analysis/m/transcript.json'), transcript);
    store.transcript('film', 'm');
    const projectBytes = readFileSync(join(root, 'film/project.json'));
    const events: string[] = [];
    store.on('deleted', (name) => events.push(name));
    const entry = manager.delete('film');
    expect(entry).toMatchObject({ name: 'film', displayName: 'فيلم' });
    expect(events).toEqual(['film']);
    expect(store.list()).toEqual([]);
    expect(() => store.get('film')).toThrow('not found');
    expect(existsSync(join(root, 'film'))).toBe(false);
    await store.close();
    store = new Store(root, { watch: false });
    manager = new ProjectManagement(store, jobs);
    expect(manager.list()).toEqual([entry]);
    const restored = manager.restore(entry.id);
    expect(restored).toMatchObject({ name: 'film', project: { name: 'فيلم' }, rev: 0, history: { undo: 0, redo: 0 } });
    expect(readFileSync(join(root, 'film/project.json'))).toEqual(projectBytes);
    for (const [file, bytes] of contents) expect(readFileSync(join(root, 'film', file))).toEqual(bytes);
    expect(store.transcript('film', 'm')).toEqual(JSON.parse(transcript));
    expect(manager.list()).toEqual([]);
    expect(() => manager.restore(entry.id)).toThrow('not found');
  });

  it('never overwrites an existing original folder, including an empty folder', () => {
    store.create('film');
    const entry = manager.delete('film');
    mkdirSync(join(root, 'film'));
    expect(() => manager.restore(entry.id)).toThrow('occupies');
    expect(manager.list()).toEqual([entry]);
    expect(existsSync(join(root, '.trash', entry.id, 'project/project.json'))).toBe(true);
  });

  it('invalidates undo/transcript caches and Windows case aliases after a round trip', () => {
    store.create('film');
    store.apply('film', [{ op: 'rename_project', name: 'Saved title' }]);
    mkdirSync(join(root, 'film/analysis/m'), { recursive: true });
    const transcript = { mediaId: 'm', language: 'ar', words: [] };
    writeFileSync(join(root, 'film/analysis/m/transcript.json'), JSON.stringify(transcript));
    store.transcript('film', 'm');
    if (process.platform === 'win32') {
      store.get('FILM');
      store.transcript('FILM', 'm');
    }
    const entry = manager.delete('film');
    const nextTranscript = { ...transcript, language: 'en' };
    writeFileSync(join(root, '.trash', entry.id, 'project/analysis/m/transcript.json'), JSON.stringify(nextTranscript));
    expect(() => store.get('film')).toThrow('not found');
    const restored = manager.restore(entry.id);
    expect(restored.history).toEqual({ undo: 0, redo: 0, rev: 0 });
    expect(store.transcript('film', 'm')).toEqual(nextTranscript);
    if (process.platform === 'win32') {
      expect(store.history('FILM')).toEqual(restored.history);
      expect(store.transcript('FILM', 'm')).toEqual(nextTranscript);
    }
  });

  it('refuses traversal, reserved Windows names, project links, nested junctions and linked trash', () => {
    for (const name of ['../other', '..', 'C:\\outside', 'film.', 'film ', 'NUL', 'CON.txt']) expect(() => store.dir(name)).toThrow();
    store.create('film');
    const outside = mkdtempSync(join(workspace, 'outside-'));
    writeFileSync(join(outside, 'precious.txt'), 'untouched');
    const link = join(root, 'film/source/link');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => manager.delete('film')).toThrow(/links|junctions/);
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('untouched');
    unlinkSync(link);
    const projectLink = join(root, 'linked-film');
    symlinkSync(join(root, 'film'), projectLink, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => manager.delete('linked-film')).toThrow(/links|junctions/);
    unlinkSync(projectLink);
    symlinkSync(outside, join(root, '.trash'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => manager.delete('film')).toThrow(/links|junctions/);
    expect(existsSync(join(root, 'film/project.json'))).toBe(true);
    unlinkSync(join(root, '.trash'));
  });

  it('rejects linked payloads and forged metadata inside trash before restoring', () => {
    store.create('film');
    const entry = manager.delete('film');
    const payload = join(root, '.trash', entry.id, 'project');
    const outside = join(workspace, `payload-${entry.id}`);
    renameSync(payload, outside);
    symlinkSync(outside, payload, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => manager.restore(entry.id)).toThrow(/links|junctions/);
    expect(existsSync(join(outside, 'project.json'))).toBe(true);
    unlinkSync(payload);
    renameSync(outside, payload);
    const metadata = join(root, '.trash', entry.id, 'entry.json');
    const saved = readFileSync(metadata, 'utf8');
    writeFileSync(metadata, JSON.stringify({ ...entry, name: '../outside' }));
    expect(() => manager.restore(entry.id)).toThrow('invalid project name');
    writeFileSync(metadata, saved);
    expect(manager.restore(entry.id).name).toBe('film');
  });

  it('rejects queued and running jobs and permits deletion only after they finish', async () => {
    store.create('film');
    let finish!: () => void;
    const job = jobs.add('analyze', 'film', 'test', () => new Promise<void>((resolve) => { finish = resolve; }));
    expect(job.status).toBe('queued');
    expect(() => manager.delete('film')).toThrow('queued or running');
    await Promise.resolve();
    expect(job.status).toBe('running');
    expect(() => manager.delete('film')).toThrow('queued or running');
    finish();
    await jobs.wait(job.id, 1000);
    expect(manager.delete('film').name).toBe('film');
  });

  it('finds active jobs beyond the 50-row public history limit', async () => {
    let finish!: () => void;
    const job = jobs.add('render', 'film', 'running', () => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    for (let i = 0; i < 60; i++) { const queued = jobs.add('render', `other-${i}`, 'other', async () => {}); jobs.cancel(queued.id); }
    expect(jobs.hasActive('film')).toBe(true);
    if (process.platform === 'win32') expect(jobs.hasActive('FILM')).toBe(true);
    finish();
    await jobs.wait(job.id, 1000);
  });

  it('implements the HTTP contract and denies static access to trashed media', async () => {
    store.create('film');
    writeFileSync(join(root, 'film/source/original.mp4'), 'original');
    const server = await api();
    expect((await server.inject('/files/film/source/original.mp4')).statusCode).toBe(200);
    expect((await server.inject({ method: 'PATCH', url: '/api/projects/film', payload: { name: '' } })).statusCode).toBe(400);
    expect((await server.inject({ method: 'PATCH', url: '/api/projects/missing', payload: { name: 'valid' } })).statusCode).toBe(404);
    expect((await server.inject({ method: 'DELETE', url: '/api/projects/missing' })).statusCode).toBe(404);
    const deleted = await server.inject({ method: 'DELETE', url: '/api/projects/film' });
    expect(deleted.statusCode).toBe(200);
    const entry = deleted.json().trashed;
    expect(deleted.json()).toMatchObject({ ok: true, trashed: { name: 'film' } });
    expect((await server.inject('/api/projects/.trash')).json()).toEqual([entry]);
    for (const prefix of ['.trash', '%2etrash']) {
      const file = await server.inject(`/files/${prefix}/${entry.id}/project/source/original.mp4`);
      expect(file.statusCode).not.toBe(200);
      expect(file.body).not.toBe('original');
    }
    expect((await server.inject({ method: 'POST', url: '/api/projects/.trash/not-an-id/restore' })).statusCode).toBe(400);
    store.create('film');
    expect((await server.inject({ method: 'POST', url: `/api/projects/.trash/${entry.id}/restore` })).statusCode).toBe(409);
    manager.delete('film');
    const restored = await server.inject({ method: 'POST', url: `/api/projects/.trash/${entry.id}/restore` });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ name: 'film', project: { name: 'film' }, rev: 0 });
  });

  it('blocks deletion while a multipart upload is still writing, then allows it', async () => {
    store.create('film');
    const server = await api();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    server.post<{ Params: { name: string } }>('/api/projects/:name/upload', async (req) => {
      for await (const file of req.files()) {
        started();
        await pipeline(file.file, createWriteStream(join(store.dir(req.params.name), 'source/upload.bin')));
      }
      return { ok: true };
    });
    const body = new PassThrough();
    const uploading = server.inject({ method: 'POST', url: '/api/projects/film/upload', headers: { 'content-type': 'multipart/form-data; boundary=testboundary' }, payload: body }).then((response) => response);
    body.write('--testboundary\r\nContent-Disposition: form-data; name="file"; filename="upload.bin"\r\nContent-Type: application/octet-stream\r\n\r\nfirst chunk');
    await entered;
    const blocked = await server.inject({ method: 'DELETE', url: '/api/projects/film' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toContain('active requests');
    body.end(' last chunk\r\n--testboundary--\r\n');
    expect((await uploading).statusCode).toBe(200);
    expect(readFileSync(join(root, 'film/source/upload.bin'), 'utf8')).toBe('first chunk last chunk');
    expect((await server.inject({ method: 'DELETE', url: '/api/projects/film' })).statusCode).toBe(200);
  });

  it('keeps a disconnected request locked until its handler settles and then releases it', async () => {
    store.create('film');
    const server = await api();
    let started!: () => void, finish!: () => void, closed!: () => void, settled!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const work = new Promise<void>((resolve) => { finish = resolve; });
    const disconnected = new Promise<void>((resolve) => { closed = resolve; });
    const completed = new Promise<void>((resolve) => { settled = resolve; });
    server.get('/api/projects/:name/pending', async (_req, reply) => {
      reply.raw.once('close', closed);
      started();
      await work;
      settled();
      return { ok: true };
    });
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const request = httpGet(`${address}/api/projects/film/pending`);
    request.on('error', () => {}); // expected local socket hang-up
    await entered;
    request.destroy();
    await disconnected;
    expect((await server.inject({ method: 'DELETE', url: '/api/projects/film' })).statusCode).toBe(409);
    finish();
    await completed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await server.inject({ method: 'DELETE', url: '/api/projects/film' })).statusCode).toBe(200);
  });
});

describe('permanent trash removal', () => {
  it('deletes one entry through HTTP, validates IDs and never removes restored projects', async () => {
    store.create('film'); const entry = manager.delete('film');
    const server = await api();
    expect((await server.inject({ method: 'DELETE', url: '/api/projects/.trash/not-a-uuid' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'DELETE', url: `/api/projects/.trash/${entry.id}` })).statusCode).toBe(200);
    expect(existsSync(join(root, '.trash', entry.id))).toBe(false);
    expect((await server.inject({ method: 'DELETE', url: `/api/projects/.trash/${entry.id}` })).statusCode).toBe(404);
    store.create('restored'); const restored = manager.delete('restored'); manager.restore(restored.id);
    expect((await server.inject({ method: 'DELETE', url: '/api/projects/.trash' })).statusCode).toBe(200);
    expect(existsSync(join(root, '.trash', restored.id))).toBe(false);
    expect(store.get('restored').project.name).toBe('restored');
  });

  it('purges only entries older than 30 days, including restored envelopes', () => {
    const now = Date.parse('2026-10-30T00:00:00Z');
    const entries = ['old', 'boundary', 'new', 'restored'].map((name) => { store.create(name); return manager.delete(name); });
    manager.restore(entries[3].id);
    for (let i = 0; i < entries.length; i++) {
      const days = [31, 30, 29, 31][i];
      writeFileSync(join(root, '.trash', entries[i].id, 'entry.json'), JSON.stringify({ ...entries[i], deletedAt: new Date(now - days * 86400000).toISOString() }));
    }
    expect(manager.purge(now)).toBe(2);
    expect(manager.list().map((x) => x.name).sort()).toEqual(['boundary', 'new']);
    expect(store.get('restored').project.name).toBe('restored');
  });

  it('blocks a busy name and preflights empty-all before removing anything', async () => {
    store.create('idle'); const idle = manager.delete('idle');
    store.create('busy'); const busy = manager.delete('busy');
    jobs.add('test', 'busy', 'active', async () => new Promise(() => {}));
    const server = await api();
    expect((await server.inject({ method: 'DELETE', url: `/api/projects/.trash/${busy.id}` })).statusCode).toBe(409);
    expect((await server.inject({ method: 'DELETE', url: '/api/projects/.trash' })).statusCode).toBe(409);
    expect(existsSync(join(root, '.trash', idle.id))).toBe(true);
  });

  it('refuses a symlink anywhere in a payload and leaves outside files untouched', () => {
    store.create('linked'); const entry = manager.delete('linked');
    const outside = join(workspace, 'outside-delete'); mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const link = join(root, '.trash', entry.id, 'project', 'link');
    symlinkSync(outside, link, 'junction');
    expect(() => manager.remove(entry.id)).toThrow('symbolic links');
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    unlinkSync(link);
  });
});
