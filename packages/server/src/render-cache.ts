import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { outputSize, type Project } from '@edit/shared';
import { compile, fileKey } from '@edit/render';
import { assertNoLink, assertWithin, ProjectManagementError } from './project-paths.ts';
import type { Store } from './store.ts';
import type { Jobs } from './jobs.ts';
import { graphicCachePath } from './graphics.ts';
import { lutCachePath } from './luts.ts';

export const CACHE_MAX_BYTES = 3 * 1024 ** 3;
export const CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;
const usageFile = 'cache/render-usage.json';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contextKey = (project: Project) => {
  const { marks: _marks, aiNotes: _notes, ...settings } = project.settings;
  return hash([settings, project.media.map(({ id, path, proxy, kind, hasAudio, duration, width, height, fps }) => ({ id, path, proxy, kind, hasAudio, duration, width, height, fps }))]);
};
interface Usage { path: string; context: string; clips: string[] }

/** Last use is explicit: Windows may disable automatic access-time updates. Preserve mtime/cache keys. */
export function touchCache(file: string) {
  const s = lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink()) throw new Error('unsafe cache entry');
  utimesSync(file, new Date(), s.mtime);
}

export function recordCacheUse(dir: string, project: Project, files: { path: string; clipIds: string[] }[]) {
  assertNoLink(join(dir, 'cache'));
  const path = join(dir, usageFile);
  assertNoLink(path);
  let previous: Usage[] = [];
  try { previous = JSON.parse(readFileSync(path, 'utf8')).files ?? []; } catch { /* first render */ }
  const context = contextKey(project);
  const records = new Map(previous.map((r) => [r.path, r]));
  for (const file of files) {
    touchCache(join(dir, file.path));
    records.set(file.path, { path: file.path, context, clips: file.clipIds.map((id) => project.clips.find((c) => c.id === id)).filter(Boolean).map(hash) });
  }
  writeFileSync(path, JSON.stringify({ files: [...records.values()].filter((r) => existsSync(join(dir, r.path))) }));
}

export interface CacheEntry { path: string; bytes: number; usedAt: number; managed: boolean }

/** Preflight the entire tree before deleting anything; links/junctions are never traversed. */
export function cacheEntries(dir: string): CacheEntry[] {
  assertNoLink(dir);
  const root = join(dir, 'cache');
  assertNoLink(root);
  if (!existsSync(root)) return [];
  const out: CacheEntry[] = [];
  const walk = (path: string) => {
    assertWithin(root, path);
    assertNoLink(path);
    const s = lstatSync(path);
    if (s.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    else if (s.isFile()) {
      const rel = relative(dir, path).replace(/\\/g, '/');
      out.push({ path: rel, bytes: s.size, usedAt: Math.max(s.atimeMs, s.mtimeMs), managed: /^cache\/(graphics|segments)\//.test(rel) });
    } else throw new Error('unsupported cache entry');
  };
  for (const name of readdirSync(root)) walk(join(root, name));
  return out;
}

export function selectCacheCleanup(entries: CacheEntry[], used: Set<string>, now = Date.now(), cap = CACHE_MAX_BYTES) {
  let remaining = entries.reduce((s, e) => s + e.bytes, 0);
  const remove: CacheEntry[] = [];
  const candidates = entries.filter((e) => e.managed).sort((a, b) => a.usedAt - b.usedAt || a.path.localeCompare(b.path));
  for (const e of candidates) {
    if (!used.has(e.path) && now - e.usedAt > CACHE_RETENTION_MS) { remove.push(e); remaining -= e.bytes; }
  }
  // the cap only trims what the project no longer needs: dropping live entries would re-render them every export
  for (const e of candidates) {
    if (remaining <= cap) break;
    if (!used.has(e.path) && !remove.includes(e)) { remove.push(e); remaining -= e.bytes; }
  }
  return { remove, remaining };
}

export function cleanRenderCache(dir: string, project: Project, { dryRun = false, now = Date.now(), cap = CACHE_MAX_BYTES } = {}) {
  const entries = cacheEntries(dir);
  let used = new Set<string>();
  try {
    const usage = JSON.parse(readFileSync(join(dir, usageFile), 'utf8'));
    const context = contextKey(project), clips = new Set(project.clips.map(hash));
    if (Array.isArray(usage.files)) used = new Set((usage.files as Usage[]).filter((r) => r.context === context && r.clips.some((c) => clips.has(c))).map((r) => r.path));
  } catch { /* legacy cache has no recorded references */ }
  // Resolve the live project's usual outputs too, including caches made before the usage ledger.
  for (const quality of ['preview', 'final'] as const) {
    for (const nvenc of [false, true]) {
      const plan = compile(project, { quality, nvenc, fileKey: fileKey(dir), lutFile: (lut, mix) => lutCachePath(readFileSync(join(dir, lut), 'utf8'), mix) });
      for (const segment of plan.segments) used.add(segment.output);
    }
    const width = outputSize({ ...project.settings, resolution: quality === 'preview' ? Math.min(720, project.settings.resolution) : project.settings.resolution }).width;
    for (const clip of project.clips) if (clip.graphic) {
      try { used.add(graphicCachePath(dir, clip, project.settings, width, project.settings.fps, quality === 'final' ? project.settings.motionBlur : 1)); }
      catch { /* missing graphic is reported by export preflight */ }
    }
  }
  const plan = selectCacheCleanup(entries, used, now, cap);
  if (!dryRun) for (const e of plan.remove) {
    const path = join(dir, e.path);
    assertWithin(join(dir, 'cache'), path);
    assertNoLink(join(dir, 'cache')); assertNoLink(join(dir, 'cache', e.path.split('/')[1]));
    assertNoLink(path);
    unlinkSync(path);
  }
  return { bytes: entries.reduce((s, e) => s + e.bytes, 0), remaining: plan.remaining, removedBytes: plan.remove.reduce((s, e) => s + e.bytes, 0), removed: plan.remove.map((e) => e.path) };
}

export function registerRenderCache(app: FastifyInstance, store: Store, queues: Jobs[]) {
  const pending = new Set<string>();
  const busy = (name: string) => queues.some((q) => q.hasActive(name));
  const clean = (name: string) => {
    if (busy(name)) { pending.add(name); return; }
    pending.delete(name);
    try { cleanRenderCache(store.dir(name), store.get(name).project); }
    catch (e) { app.log.warn({ err: e, project: name }, 'cache cleanup skipped'); }
  };
  const listener = (job: { kind: string; project: string; status: string }) => {
    if (job.kind === 'render' && job.status === 'done') pending.add(job.project);
    if (['done', 'error', 'cancelled'].includes(job.status)) queueMicrotask(() => { for (const name of pending) clean(name); });
  };
  for (const q of queues) q.on('job', listener);
  app.addHook('onReady', async () => { for (const p of store.list()) clean(p.name); });
  app.addHook('onClose', async () => { for (const q of queues) q.off('job', listener); });
  app.get<{ Params: { name: string } }>('/api/projects/:name/cache', async (req) => {
    const name = req.params.name;
    return { ...cleanRenderCache(store.dir(name), store.get(name).project, { dryRun: true }), busy: busy(name) };
  });
  app.post<{ Params: { name: string } }>('/api/projects/:name/cache/cleanup', async (req) => {
    const name = req.params.name;
    if (busy(name)) throw new ProjectManagementError('انتظر اكتمال مهام المشروع لتنظيف الملفات المؤقتة.', 409);
    return { ...cleanRenderCache(store.dir(name), store.get(name).project), busy: false };
  });
}
