import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { Store } from '../src/store.ts';
import { registerFolders, safeFileName, type Folders } from '../src/folders.ts';

let root: string, store: Store, app: FastifyInstance, folders: Folders;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'edit-folders-test-'));
  store = new Store(root, { watch: false });
  for (const n of ['حلقة-1', 'حلقة-2', 'شورت']) store.create(n);
  app = Fastify();
  await app.register(fastifyMultipart);
  folders = registerFolders(app, store);
  await app.ready();
});
afterEach(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });

const multipart = (name: string, body: string) => {
  const b = '----qassa';
  return { payload: `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${body}\r\n--${b}--\r\n`, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
};

describe('home-page folders', () => {
  it('creates a folder that lists projects without moving them, and the library ignores its directory', async () => {
    const f = (await app.inject({ method: 'POST', url: '/api/folders', payload: { name: 'سلسلة يارا', projects: ['حلقة-1', 'لا-يوجد'] } })).json();
    expect(f.projects).toEqual(['حلقة-1']);
    expect(existsSync(join(root, 'حلقة-1', 'project.json'))).toBe(true);
    expect(store.list().map((p) => p.name).sort()).toEqual(['حلقة-1', 'حلقة-2', 'شورت'].sort());
    const list = (await app.inject({ url: '/api/folders' })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'سلسلة يارا', notes: '', files: [] });
  });

  it('keeps a project in one folder at most', async () => {
    const a = folders.create('أ', ['حلقة-1', 'حلقة-2']);
    const b = folders.create('ب');
    folders.update(b.id, { projects: ['حلقة-2'] });
    const byName = Object.fromEntries(folders.list().map((f) => [f.name, f.projects]));
    expect(byName['أ']).toEqual(['حلقة-1']);
    expect(byName['ب']).toEqual(['حلقة-2']);
    expect(folders.of('حلقة-2')?.id).toBe(b.id);
    expect(folders.of('شورت')).toBeUndefined();
    expect(a.id).not.toBe(b.id);
  });

  it('hides a trashed project but keeps its place for a restore', () => {
    const f = folders.create('أ', ['حلقة-1', 'شورت']);
    rmSync(join(root, 'شورت'), { recursive: true }); // as if moved to the trash
    folders.update(f.id, { notes: 'الفكرة' });
    expect(folders.list()[0].projects).toEqual(['حلقة-1']);
    store.create('شورت'); // restored
    expect(folders.list()[0]).toMatchObject({ projects: ['حلقة-1', 'شورت'], notes: 'الفكرة' });
  });

  it('stores shared files under their own names, serves and deletes them', async () => {
    const f = folders.create('أ');
    const up = await app.inject({ method: 'POST', url: `/api/folders/${f.id}/files`, ...multipart('سكربت.txt', 'مرحبا') });
    expect(up.json().added).toEqual(['سكربت.txt']);
    const again = await app.inject({ method: 'POST', url: `/api/folders/${f.id}/files`, ...multipart('سكربت.txt', 'ثاني') });
    expect(again.json().added).toEqual(['سكربت (2).txt']);
    const got = await app.inject({ url: `/api/folders/${f.id}/files/${encodeURIComponent('سكربت.txt')}` });
    expect(got.statusCode).toBe(200);
    expect(got.body).toBe('مرحبا');
    expect(got.headers['content-type']).toContain('text/plain');
    const del = await app.inject({ method: 'DELETE', url: `/api/folders/${f.id}/files/${encodeURIComponent('سكربت.txt')}` });
    expect(del.json().files.map((x: { name: string }) => x.name)).toEqual(['سكربت (2).txt']);
  });

  it('refuses unsafe ids and file names', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/folders/..', payload: { notes: 'x' } })).statusCode).toBeGreaterThanOrEqual(400);
    const f = folders.create('أ');
    expect((await app.inject({ url: `/api/folders/${f.id}/files/${encodeURIComponent('../folder.json')}` })).statusCode).toBe(404);
    expect(safeFileName('..\\..\\evil.txt')).toBe('evil.txt');
    expect(() => safeFileName('con.txt')).toThrow();
    expect((await app.inject({ method: 'PATCH', url: `/api/folders/${f.id}`, payload: { name: '' } })).statusCode).toBe(400);
  });

  it('deletes a folder with its files but leaves the projects', async () => {
    const f = folders.create('أ', ['حلقة-1']);
    await app.inject({ method: 'POST', url: `/api/folders/${f.id}/files`, ...multipart('a.txt', 'x') });
    expect((await app.inject({ method: 'DELETE', url: `/api/folders/${f.id}` })).json()).toEqual({ ok: true });
    expect(folders.list()).toEqual([]);
    expect(existsSync(join(root, 'حلقة-1', 'project.json'))).toBe(true);
  });
});
