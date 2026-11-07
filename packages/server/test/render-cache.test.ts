import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import Fastify from 'fastify';
import { Clip, Project } from '@edit/shared';
import { CACHE_RETENTION_MS, cacheEntries, cleanRenderCache, recordCacheUse, registerRenderCache, selectCacheCleanup, touchCache } from '../src/render-cache.ts';
import { graphicCachePath, GRAPHIC_CACHE_VERSION, graphicFrameList } from '../src/graphics.ts';
import { Store } from '../src/store.ts';
import { Jobs } from '../src/jobs.ts';
import { compile, fileKey } from '@edit/render';

const roots: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'qassa-cache-test-')); roots.push(dir); return dir; };
afterEach(() => { for (const dir of roots.splice(0)) { if (!relative(resolve(tmpdir()), dir).startsWith('qassa-cache-test-')) throw new Error('unsafe cleanup'); rmSync(dir, { recursive: true, force: true }); } });
const project = () => Project.parse({ name: 'test', createdAt: '2026-11-07', clips: [{ id: 'a', trackId: 'V2', graphic: 'graphics/g', in: 0, out: 64, start: 0 }] });
const old = Date.now() - CACHE_RETENTION_MS - 60_000;
const file = (dir: string, rel: string, time = old) => { const path = join(dir, rel); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, 'cache'); utimesSync(path, time / 1000, time / 1000); return path; };

describe('render cache', () => {
  it('ages only unused entries, retains recent entries, then enforces the cap oldest first', () => {
    const entries = [
      { path: 'cache/graphics/used', bytes: 10, usedAt: old, managed: true },
      { path: 'cache/graphics/stale', bytes: 20, usedAt: old, managed: true },
      { path: 'cache/segments/recent', bytes: 30, usedAt: Date.now(), managed: true },
      { path: 'cache/text/keep', bytes: 40, usedAt: old, managed: false },
    ];
    expect(selectCacheCleanup(entries, new Set([entries[0].path])).remove.map((e) => e.path)).toEqual([entries[1].path]);
    // over the cap: unused entries go oldest first, even recent ones; what the project uses stays
    expect(selectCacheCleanup(entries, new Set([entries[0].path]), Date.now(), 70).remove.map((e) => e.path)).toEqual([entries[1].path, entries[2].path]);
    expect(selectCacheCleanup(entries, new Set(entries.map((e) => e.path)), Date.now(), 1).remove).toEqual([]);
    expect(selectCacheCleanup([{ ...entries[1], usedAt: 0 }], new Set(), CACHE_RETENTION_MS).remove).toEqual([]);
  });

  it('deletes only stale generated files and dry-run never writes; records current uses across unrelated edits', () => {
    const dir = temp(), p = project();
    for (const rel of ['source/keep', 'renders/keep', 'analysis/keep', 'cache/text/keep', 'cache/graphics/used', 'cache/graphics/stale', 'cache/segments/recent']) file(dir, rel, rel.endsWith('recent') ? Date.now() : old);
    recordCacheUse(dir, p, [{ path: 'cache/graphics/used', clipIds: ['a'] }]);
    utimesSync(join(dir, 'cache/graphics/used'), old / 1000, old / 1000);
    p.notes.push({ id: 'n', at: 0, text: 'comment', author: 'user', status: 'open' });
    const before = readFileSync(join(dir, 'cache/render-usage.json'), 'utf8');
    const plan = cleanRenderCache(dir, p, { dryRun: true });
    expect(plan.removed).toEqual(['cache/graphics/stale']);
    expect(existsSync(join(dir, 'cache/graphics/stale'))).toBe(true);
    expect(readFileSync(join(dir, 'cache/render-usage.json'), 'utf8')).toBe(before);
    cleanRenderCache(dir, p);
    expect(existsSync(join(dir, 'cache/graphics/stale'))).toBe(false);
    for (const rel of ['source/keep', 'renders/keep', 'analysis/keep', 'cache/text/keep', 'cache/graphics/used', 'cache/segments/recent']) expect(existsSync(join(dir, rel))).toBe(true);
    p.clips = [];
    expect(cleanRenderCache(dir, p, { dryRun: true }).removed).toEqual(['cache/graphics/used']);
  });

  it('touches last use without invalidating mtime-based render keys', () => {
    const path = file(temp(), 'cache/segments/a');
    const before = lstatSync(path); touchCache(path); const after = lstatSync(path);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.atimeMs).toBeGreaterThan(old);
  });

  it('keeps a current legacy segment without a ledger while deleting an obsolete segment', () => {
    const dir = temp(); file(dir, 'source/clip.mp4');
    const p = Project.parse({ name: 'legacy', createdAt: '2026-11-07', media: [{ id: 'm', name: 'clip', path: 'source/clip.mp4', role: 'source', kind: 'video', duration: 3, hasAudio: false }], clips: [{ id: 'c', mediaId: 'm', trackId: 'V1', in: 0, out: 3, start: 0 }] });
    const plan = compile(p, { quality: 'final', nvenc: false, fileKey: fileKey(dir) });
    file(dir, plan.segments[0].output); file(dir, 'cache/segments/obsolete.mov');
    expect(cleanRenderCache(dir, p).removed).toEqual(['cache/segments/obsolete.mov']);
    expect(existsSync(join(dir, plan.segments[0].output))).toBe(true);
  });

  it('refuses links before any deletion, including a cache root junction', () => {
    const dir = temp(), outside = temp(); file(outside, 'precious'); file(dir, 'cache/graphics/stale');
    symlinkSync(outside, join(dir, 'cache/graphics/link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => cleanRenderCache(dir, project())).toThrow();
    expect(existsSync(join(dir, 'cache/graphics/stale'))).toBe(true);
    expect(readFileSync(join(outside, 'precious'), 'utf8')).toBe('cache');
    const second = temp(); symlinkSync(outside, join(second, 'cache'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => cacheEntries(second)).toThrow();
  });

  it('defers startup/manual cleanup for queued/running jobs and retries after the queue ends', async () => {
    const root = temp(), store = new Store(root, { watch: false }), jobs = new Jobs();
    store.create('busy'); const stale = file(store.dir('busy'), 'cache/graphics/stale');
    let release!: () => void;
    const job = jobs.add('analysis', 'busy', 'busy', () => new Promise<void>((r) => { release = r; }));
    const app = Fastify();
    registerRenderCache(app, store, [jobs]); await app.ready();
    expect(existsSync(stale)).toBe(true);
    expect((await app.inject('/api/projects/busy/cache')).json().busy).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/projects/busy/cache/cleanup' })).statusCode).toBe(409);
    release(); await jobs.wait(job.id, 1000); await new Promise((r) => setTimeout(r, 0));
    expect(existsSync(stale)).toBe(false);
    await app.close(); await store.close();
  });

  it('keys version/blur/data/retime/edits/files but ignores timeline placement and capture parallelism', () => {
    const dir = temp(); file(dir, 'graphics/g/index.html');
    const p = project(), c = p.clips[0];
    const key = (clip = c, samples = 1) => graphicCachePath(dir, clip, p.settings, 1080, 30, samples);
    expect(GRAPHIC_CACHE_VERSION).toBeGreaterThan(1);
    expect(key()).toMatch(/\.rgba\.mkv$/);
    expect(key(Clip.parse({ ...c, start: 50 }))).toBe(key());
    for (const patch of [{ graphicData: { title: 'new' } }, { graphicEdits: [{ target: 'h1', hidden: true }] }, { retime: { from: [0, 64], to: [0, 70] } }, { speed: 2 }]) expect(key(Clip.parse({ ...c, ...patch }))).not.toBe(key());
    expect(key(c, 4)).not.toBe(key());
    const before = key(); writeFileSync(join(dir, 'graphics/g/index.html'), 'changed content'); expect(key()).not.toBe(before);
    expect(graphicFrameList([{ file: '0.png', count: 30 }], 30)).toContain('duration 0.9666666666666667');
  });
});
