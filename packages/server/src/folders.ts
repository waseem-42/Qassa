// Project folders on the home page: a big project (a series, a client, a campaign) that holds smaller projects,
// plus what belongs to the whole thing — its brief/notes and shared files (script, references, logos, documents).
// Projects stay where they are (projects/<name>/); a folder only lists their names, so nothing moves on disk.
// Stored in projects/.folders/<id>/folder.json with the files in projects/.folders/<id>/files/.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from './store.ts';
import { assertNoLink, assertWithin } from './project-paths.ts';

export const Folder = z.object({
  id: z.string().regex(/^[a-z0-9]{6,40}$/),
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(100_000).default(''),
  projects: z.array(z.string()).default([]),
  createdAt: z.string(),
  modified: z.number(),
});
export type Folder = z.infer<typeof Folder>;
export interface FolderFile { name: string; size: number; modified: number }

const Patch = z.object({
  name: z.string().trim().min(1).max(120).refine((s) => !/[\u0000-\u001f\u007f]/.test(s)).optional(),
  notes: z.string().max(100_000).optional(),
  projects: z.array(z.string().max(200)).max(5000).optional(),
}).strict();

class FolderError extends Error { constructor(message: string, public readonly statusCode: number) { super(message); } }

/** a shared file keeps the name it was uploaded with (minus path and control characters) */
export function safeFileName(raw: string): string {
  const name = basename(raw.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '').replace(/^[. ]+|[. ]+$/g, '').slice(0, 150);
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new FolderError('اسم الملف غير صالح', 400);
  return name;
}

export class Folders {
  constructor(private readonly store: Store) {}
  private get root() { return join(this.store.root, '.folders'); }
  private dir(id: string) {
    if (!/^[a-z0-9]{6,40}$/.test(id)) throw new FolderError('invalid folder id', 400);
    const dir = join(this.root, id);
    assertWithin(this.root, dir); assertNoLink(this.root); assertNoLink(dir);
    return dir;
  }
  private read(id: string): Folder {
    const file = join(this.dir(id), 'folder.json');
    if (!existsSync(file)) throw new FolderError('المجلد غير موجود', 404);
    return Folder.parse(JSON.parse(readFileSync(file, 'utf8')));
  }
  private write(f: Folder) {
    const dir = this.dir(f.id);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, 'folder.json.tmp');
    writeFileSync(tmp, JSON.stringify(f, null, 2));
    renameSync(tmp, join(dir, 'folder.json'));
    this.store.emit('projects');
  }
  files(id: string): FolderFile[] {
    const dir = join(this.dir(id), 'files');
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => {
      const s = statSync(join(dir, d.name));
      return { name: d.name, size: s.size, modified: s.mtimeMs };
    }).sort((a, b) => b.modified - a.modified);
  }
  /** every folder, with only projects that still exist (a trashed project comes back into its folder on restore) */
  list(): (Folder & { files: FolderFile[] })[] {
    if (!existsSync(this.root)) return [];
    const names = new Set(this.store.list().map((p) => p.name));
    return readdirSync(this.root, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
      try { const f = this.read(d.name); return [{ ...f, projects: f.projects.filter((p) => names.has(p)), files: this.files(f.id) }]; }
      catch { return []; }
    }).sort((a, b) => b.modified - a.modified);
  }
  /** the folder a project is in, if any (Claude reads its notes and files as the bigger brief) */
  of(project: string) { return this.list().find((f) => f.projects.includes(project)); }
  create(name: string, projects: string[] = []): Folder {
    const f: Folder = { id: randomUUID().replace(/-/g, '').slice(0, 12), name: Patch.shape.name.unwrap().parse(name), notes: '', projects: [], createdAt: new Date().toISOString(), modified: Date.now() };
    this.write(f);
    return projects.length ? this.update(f.id, { projects }) : f;
  }
  update(id: string, raw: unknown): Folder {
    const patch = Patch.parse(raw);
    const f = this.read(id);
    if (patch.projects) {
      const known = new Set(this.store.list().map((p) => p.name));
      const wanted = [...new Set(patch.projects)].filter((p) => known.has(p));
      // a project lives in one folder: joining this one takes it out of any other
      for (const other of this.list()) if (other.id !== id && other.projects.some((p) => wanted.includes(p) && !f.projects.includes(p))) {
        const o = this.read(other.id);
        this.write({ ...o, projects: o.projects.filter((p) => !wanted.includes(p)), modified: Date.now() });
      }
      // keep names of projects that are in the trash right now, so a restore puts them back
      f.projects = [...wanted, ...f.projects.filter((p) => !known.has(p) && !wanted.includes(p))];
    }
    if (patch.name !== undefined) f.name = patch.name;
    if (patch.notes !== undefined) f.notes = patch.notes;
    f.modified = Date.now();
    this.write(f);
    return f;
  }
  /** removes the folder, its notes and its shared files; the projects in it stay in the library */
  remove(id: string) {
    this.read(id);
    rmSync(this.dir(id), { recursive: true, force: true });
    this.store.emit('projects');
    return { ok: true };
  }
  filePath(id: string, file: string) {
    const dir = join(this.dir(id), 'files'), path = join(dir, safeFileName(file));
    assertWithin(dir, path); assertNoLink(path);
    return path;
  }
  /** a free name next to the others: «سكربت.pdf» then «سكربت (2).pdf» */
  freeName(id: string, raw: string) {
    const name = safeFileName(raw), ext = extname(name), stem = name.slice(0, name.length - ext.length);
    let n = 1, candidate = name;
    while (existsSync(this.filePath(id, candidate))) candidate = `${stem} (${++n})${ext}`;
    return candidate;
  }
  touch(id: string) { const f = this.read(id); f.modified = Date.now(); this.write(f); }
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};

export function registerFolders(app: FastifyInstance, store: Store): Folders {
  const folders = new Folders(store);
  const guard = <T>(fn: () => T) => {
    try { return fn(); }
    catch (e) { if (e instanceof z.ZodError) throw Object.assign(new Error('بيانات المجلد غير صالحة'), { statusCode: 400 }); throw e; }
  };
  app.get('/api/folders', async () => folders.list());
  app.post<{ Body: { name: string; projects?: string[] } }>('/api/folders', async (req) => guard(() => folders.create(req.body?.name, req.body?.projects ?? [])));
  app.patch<{ Params: { id: string } }>('/api/folders/:id', async (req) => guard(() => folders.update(req.params.id, req.body)));
  app.delete<{ Params: { id: string } }>('/api/folders/:id', async (req) => folders.remove(req.params.id));
  app.post<{ Params: { id: string } }>('/api/folders/:id/files', async (req) => {
    const { id } = req.params;
    folders.files(id); // checks the folder exists
    mkdirSync(join(store.root, '.folders', id, 'files'), { recursive: true });
    const added: string[] = [];
    for await (const part of req.files({ defCharset: 'utf8' })) {
      const name = folders.freeName(id, part.filename), dest = folders.filePath(id, name);
      try {
        await pipeline(part.file, createWriteStream(dest, { flags: 'wx' }));
        if (part.file.truncated || req.raw.aborted) throw new FolderError('أُلغي الرفع أو تجاوز الملف الحد', 400);
        added.push(name);
      } catch (e) { rmSync(dest, { force: true }); throw e; }
    }
    folders.touch(id);
    return { added, files: folders.files(id) };
  });
  app.get<{ Params: { id: string; file: string }; Querystring: { download?: string } }>('/api/folders/:id/files/:file', async (req, reply) => {
    const path = folders.filePath(req.params.id, req.params.file);
    if (!existsSync(path)) throw new FolderError('الملف غير موجود', 404);
    const name = basename(path);
    reply.header('content-type', MIME[extname(name).toLowerCase()] ?? 'application/octet-stream');
    reply.header('content-disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    reply.header('x-content-type-options', 'nosniff');
    // svg and html could run script on our origin: never inline them
    if (/\.(svg|html?)$/i.test(name)) reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return reply.send(createReadStream(path));
  });
  app.delete<{ Params: { id: string; file: string } }>('/api/folders/:id/files/:file', async (req) => {
    const path = folders.filePath(req.params.id, req.params.file);
    if (!existsSync(path)) throw new FolderError('الملف غير موجود', 404);
    rmSync(path, { force: true });
    folders.touch(req.params.id);
    return { files: folders.files(req.params.id) };
  });
  return folders;
}
