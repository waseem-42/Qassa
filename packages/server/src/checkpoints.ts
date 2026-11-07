import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applyOps, Project, ProjectDisplayName } from '@edit/shared';
import type { Store } from './store.ts';
import type { Jobs } from './jobs.ts';
import { assertNoLink, assertWithin, ProjectManagementError } from './project-paths.ts';
import { hasActiveProjectRequests } from './project-management.ts';

export const CheckpointMetadata = z.object({
  id: z.string().uuid(), label: ProjectDisplayName, createdAt: z.string().datetime(),
  sourceRev: z.number().int().nonnegative(), kind: z.enum(['manual', 'before_restore']),
});
export type CheckpointMetadata = z.infer<typeof CheckpointMetadata>;
const Snapshot = z.object({ version: z.literal(1), projectId: z.string(), checkpoint: CheckpointMetadata, project: Project });
const RestoreBody = z.object({ expectedRev: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();

export class Checkpoints {
  constructor(private store: Store, private jobs: Pick<Jobs, 'hasActive'>) {}

  private dir(name: string, create = false): string {
    this.store.get(name);
    const project = this.store.dir(name), dir = join(project, '.checkpoints');
    assertWithin(project, dir);
    assertNoLink(dir);
    if (create) mkdirSync(dir);
    return dir;
  }

  private read(name: string, id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new ProjectManagementError('invalid checkpoint ID', 400);
    const dir = this.dir(name), file = join(dir, `${id}.json`);
    assertWithin(dir, file);
    assertNoLink(file);
    if (!existsSync(file)) throw new ProjectManagementError('checkpoint not found', 404);
    try {
      const snapshot = Snapshot.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (snapshot.checkpoint.id !== id) throw new Error('checkpoint ID does not match');
      if (snapshot.projectId !== basename(realpathSync(this.store.dir(name)))) throw new Error('project identity does not match');
      return snapshot;
    } catch (err) {
      throw new ProjectManagementError(`invalid checkpoint: ${(err as Error).message}`, 400);
    }
  }

  list(name: string): CheckpointMetadata[] {
    const dir = this.dir(name);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((file) => {
      if (!file.endsWith('.json')) return [];
      try { return [this.read(name, file.slice(0, -5)).checkpoint]; }
      catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  create(name: string, label: string, kind: CheckpointMetadata['kind'] = 'manual'): CheckpointMetadata {
    const parsedLabel = ProjectDisplayName.parse(label);
    const live = this.store.get(name);
    const project = Project.parse(structuredClone(live.project));
    const checkpoint = CheckpointMetadata.parse({ id: randomUUID(), label: parsedLabel, createdAt: new Date().toISOString(), sourceRev: live.rev, kind });
    const dir = this.dir(name);
    if (!existsSync(dir)) this.dir(name, true);
    const file = join(dir, `${checkpoint.id}.json`), temp = join(dir, `.${checkpoint.id}-${randomUUID()}.tmp`);
    assertWithin(dir, file);
    assertWithin(dir, temp);
    assertNoLink(file);
    assertNoLink(temp);
    let fd: number | undefined;
    try {
      fd = openSync(temp, 'wx', 0o600);
      const projectId = basename(realpathSync(this.store.dir(name)));
      writeFileSync(fd, JSON.stringify({ version: 1, projectId, checkpoint, project }, null, 1), 'utf8');
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      // Exclusive atomic publication: a preexisting snapshot is never replaced.
      linkSync(temp, file);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temp)) unlinkSync(temp);
    }
    return checkpoint;
  }

  restore(name: string, id: string, expectedRev: number, requestId?: string) {
    RestoreBody.parse({ expectedRev });
    const live = this.store.get(name);
    if (live.rev !== expectedRev) throw new ProjectManagementError('project revision changed; reload before restoring', 409);
    if (this.jobs.hasActive(name)) throw new ProjectManagementError('project has queued or running jobs', 409);
    if (hasActiveProjectRequests(this.store, name, requestId)) throw new ProjectManagementError('project has active requests', 409);
    const snapshot = this.read(name, id);
    // Validate the complete operation before making any safety-copy side effects.
    applyOps(live.project, [{ op: 'restore_project', project: snapshot.project }], { allowProjectRestore: true });
    const safetyLabel = `قبل استعادة: ${snapshot.checkpoint.label}`.slice(0, 120).replace(/[\uD800-\uDBFF]$/u, '').trimEnd();
    const safetyCheckpoint = this.create(name, safetyLabel, 'before_restore');
    const restored = this.store.restoreProject(name, snapshot.project, expectedRev);
    return { ...restored, history: this.store.history(name), restoredCheckpointId: id, safetyCheckpoint };
  }
}

export function registerCheckpoints(app: FastifyInstance, store: Store, jobs: Jobs): void {
  const checkpoints = new Checkpoints(store, jobs);
  type Params = { name: string };
  app.get<{ Params: Params }>('/api/projects/:name/checkpoints', async (req) => checkpoints.list(req.params.name));
  app.post<{ Params: Params; Body: unknown }>('/api/projects/:name/checkpoints', async (req, reply) => {
    const { label } = z.object({ label: ProjectDisplayName }).strict().parse(req.body);
    return reply.code(201).send({ checkpoint: checkpoints.create(req.params.name, label) });
  });
  app.post<{ Params: Params & { id: string }; Body: unknown }>('/api/projects/:name/checkpoints/:id/restore', async (req) => {
    const { expectedRev } = RestoreBody.parse(req.body);
    return checkpoints.restore(req.params.name, req.params.id, expectedRev, req.id);
  });
}
