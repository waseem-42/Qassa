import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Project, ProjectDisplayName, TRASH_RETENTION_DAYS } from '@edit/shared';
import { assertNoLink, assertSafeTree, assertWithin, ProjectManagementError } from './project-paths.ts';
import type { Jobs } from './jobs.ts';
import type { Store } from './store.ts';

const TrashEntry = z.object({ id: z.string().uuid(), name: z.string(), displayName: z.string(), deletedAt: z.string().datetime() });
export type TrashEntry = z.infer<typeof TrashEntry>;

const projectRequests = new WeakMap<Store, Map<string, Set<string>>>();
const requestKey = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name;

/** Shared with checkpoint restores so an import/upload is protected before it queues a job. */
export function hasActiveProjectRequests(store: Store, name: string, exceptRequestId?: string): boolean {
  const ids = projectRequests.get(store)?.get(requestKey(name));
  return !!ids && [...ids].some((id) => id !== exceptRequestId);
}

/** All moves are synchronous, checked, and confined to one projects root. */
export class ProjectManagement {
  constructor(private store: Store, private jobs: Pick<Jobs, 'hasActive'>) {}

  private trashRoot(create = false): string {
    assertNoLink(this.store.root);
    const root = join(this.store.root, '.trash');
    assertWithin(this.store.root, root);
    assertNoLink(root);
    if (create) mkdirSync(root, { recursive: true });
    return root;
  }

  private entry(id: string, requirePayload = true): { entry: TrashEntry; dir: string; payload: string } {
    if (!z.string().uuid().safeParse(id).success) throw new ProjectManagementError('invalid trash ID', 400);
    const root = this.trashRoot(), dir = join(root, id), payload = join(dir, 'project');
    assertWithin(root, dir);
    assertNoLink(dir);
    const metadata = join(dir, 'entry.json');
    assertNoLink(metadata);
    assertNoLink(payload);
    if (!existsSync(metadata) || (requirePayload && !existsSync(join(payload, 'project.json')))) throw new ProjectManagementError('trash entry not found', 404);
    const entry = TrashEntry.parse(JSON.parse(readFileSync(metadata, 'utf8')));
    if (entry.id !== id) throw new ProjectManagementError('invalid trash metadata', 400);
    this.store.dir(entry.name); // validate original folder ID and destination boundaries
    return { entry, dir, payload };
  }

  list(): TrashEntry[] {
    const root = this.trashRoot();
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((item) => {
      if (!item.isDirectory()) return [];
      try { return [this.entry(item.name).entry]; }
      catch { return []; } // partial/invalid entries are never offered for restore
    }).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  private removable(id: string) {
    const item = this.entry(id, false);
    if (this.jobs.hasActive(item.entry.name) || hasActiveProjectRequests(this.store, item.entry.name)) throw new ProjectManagementError('project has queued or running jobs or active requests', 409);
    assertSafeTree(this.trashRoot(), item.dir);
    return item;
  }

  remove(id: string) {
    const item = this.removable(id);
    rmSync(item.dir, { recursive: true });
    this.store.emit('projects');
    return { ok: true, removed: 1 };
  }

  empty() {
    const root = this.trashRoot();
    if (!existsSync(root)) return { ok: true, removed: 0 };
    // Preflight every envelope before removing any: a busy or unsafe entry blocks empty-all.
    const items = readdirSync(root).map((id) => this.removable(id));
    for (const item of items) rmSync(item.dir, { recursive: true });
    this.store.emit('projects');
    return { ok: true, removed: items.length };
  }

  purge(now = Date.now()) {
    const root = this.trashRoot();
    if (!existsSync(root)) return 0;
    let removed = 0;
    for (const id of readdirSync(root)) {
      try {
        const { entry } = this.entry(id, false);
        if (now - Date.parse(entry.deletedAt) <= TRASH_RETENTION_DAYS * 86400000) continue;
        this.remove(id); removed++;
      } catch (error) { this.store.emit('warning', `trash purge skipped ${id}: ${(error as Error).message}`); }
    }
    return removed;
  }

  delete(name: string): TrashEntry {
    const project = this.store.get(name).project;
    if (this.jobs.hasActive(name)) throw new ProjectManagementError('project has queued or running jobs', 409);
    const source = this.store.dir(name);
    assertSafeTree(this.store.root, source);
    const root = this.trashRoot(true), id = randomUUID(), dir = join(root, id);
    const entry: TrashEntry = { id, name: basename(realpathSync(source)), displayName: project.name, deletedAt: new Date().toISOString() };
    assertWithin(root, dir);
    mkdirSync(dir); // unique envelope; rename must never replace another payload
    const metadata = join(dir, 'entry.json');
    try {
      writeFileSync(metadata, JSON.stringify(entry, null, 2), { encoding: 'utf8', flag: 'wx' });
      const target = join(dir, 'project');
      assertWithin(root, target);
      assertNoLink(dir);
      renameSync(source, target);
    } catch (err) {
      // Only remove the metadata we created; never recursively remove a project.
      if (existsSync(metadata)) unlinkSync(metadata);
      rmdirSync(dir);
      throw err;
    }
    this.store.invalidate(name);
    this.store.emit('deleted', entry.name);
    this.store.emit('projects');
    return entry;
  }

  restore(id: string) {
    const { entry, payload } = this.entry(id);
    const target = this.store.dir(entry.name);
    if (existsSync(target)) throw new ProjectManagementError('a project already occupies the original folder', 409);
    if (this.jobs.hasActive(entry.name)) throw new ProjectManagementError('project has queued or running jobs', 409);
    assertSafeTree(this.trashRoot(), payload);
    Project.parse(JSON.parse(readFileSync(join(payload, 'project.json'), 'utf8')));
    // Recheck immediately before moving. No awaited work occurs between check and move.
    assertNoLink(target);
    if (existsSync(target)) throw new ProjectManagementError('a project already occupies the original folder', 409);
    renameSync(payload, target);
    // Keep the tiny metadata envelope as a recovery record. list() requires a payload.
    this.store.invalidate(entry.name);
    this.store.emit('projects');
    return { name: entry.name, ...this.view(entry.name) };
  }

  view(name: string) {
    const e = this.store.get(name);
    return { project: e.project, rev: e.rev, history: this.store.history(name) };
  }
}

export function registerProjectManagement(app: FastifyInstance, store: Store, jobs: Jobs): void {
  const manager = new ProjectManagement(store, jobs);
  const active = new Map<string, Set<string>>();
  projectRequests.set(store, active);
  const running = new Set<string>();
  const disconnected = new Set<string>();
  const key = requestKey;
  const release = (name: string | undefined, id: string) => {
    disconnected.delete(id);
    if (!name) return;
    const ids = active.get(key(name));
    ids?.delete(id);
    if (!ids?.size) active.delete(key(name));
  };
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/projects/:name')) return;
    const handler = route.handler;
    route.handler = async function (req, reply) {
      running.add(req.id);
      try { return await handler.call(this, req, reply); }
      finally {
        running.delete(req.id);
        if (disconnected.has(req.id) || req.raw.aborted) release((req.params as { name?: string })?.name, req.id);
      }
    };
  });
  // A live upload/contact-sheet/render preparation may hold project files without
  // a queued job yet. Track those requests through response completion as well.
  app.addHook('onRequest', async (req, reply) => {
    const name = (req.params as { name?: string })?.name;
    if (!name || !req.routeOptions.url?.startsWith('/api/projects/:name')) return;
    const ids = active.get(key(name)) ?? new Set<string>();
    ids.add(req.id);
    active.set(key(name), ids);
    // A disconnected client does not imply that its handler stopped using files.
    // Keep the lock until that handler settles; parsing-only aborts can release now.
    reply.raw.once('close', () => {
      if (running.has(req.id)) disconnected.add(req.id);
      else release(name, req.id);
    });
  });
  app.addHook('onResponse', async (req) => release((req.params as { name?: string })?.name, req.id));

  const purge = () => { try { manager.purge(); } catch (error) { app.log.warn(error); } };
  app.addHook('onReady', async () => { purge(); });
  const timer = setInterval(purge, 6 * 60 * 60 * 1000);
  timer.unref();
  app.addHook('onClose', async () => { clearInterval(timer); });
  app.delete('/api/projects/.trash', async () => manager.empty());
  app.delete<{ Params: { id: string } }>('/api/projects/.trash/:id', async (req) => manager.remove(req.params.id));
  app.get('/api/projects/.trash', async () => manager.list());
  app.post<{ Params: { id: string } }>('/api/projects/.trash/:id/restore', async (req) => {
    const entry = manager.list().find((item) => item.id === req.params.id);
    if (entry && active.get(key(entry.name))?.size) throw new ProjectManagementError('project has active requests', 409);
    return manager.restore(req.params.id);
  });
  app.patch<{ Params: { name: string }; Body: unknown }>('/api/projects/:name', async (req) => {
    const { name } = z.object({ name: ProjectDisplayName }).strict().parse(req.body);
    store.apply(req.params.name, [{ op: 'rename_project', name }], 'user');
    return manager.view(req.params.name);
  });
  app.delete<{ Params: { name: string } }>('/api/projects/:name', async (req) => {
    if ((active.get(key(req.params.name))?.size ?? 0) > 1) throw new ProjectManagementError('project has active requests', 409);
    return { ok: true, trashed: manager.delete(req.params.name) };
  });
}
