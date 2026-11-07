import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import type { Page } from 'puppeteer-core';
import {
  GRAPHIC_RUNTIME, GRAPHICS_LIB_PREFIX, clipDuration, graphicBaseSize, graphicEntry, graphicUrl, isLibraryGraphic, retimedToPage, type Clip, type Settings,
} from '@edit/shared';
import { GRAPHICS_LIB_DIR, PORT } from './config.ts';
import { getBrowser } from './textimg.ts';
import { encodeGraphicParts } from './graphic-encoding.ts';
import { assertNoLink, assertWithin } from './project-paths.ts';

// HTML graphics are rendered by stepping the page's clock frame by frame in the headless browser
// and encoding 4:4:4 colour plus lossless alpha, cached by the folder's content.

export const GRAPHIC_CACHE_VERSION = 3;

/** size+mtime of every file in the composition folder, so any edit re-renders it */
function folderKey(dir: string): string {
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(d, f.name);
      if (f.isDirectory()) walk(abs);
      else { const s = statSync(abs); parts.push(`${abs.slice(dir.length)}:${s.size}:${Math.round(s.mtimeMs)}`); }
    }
  };
  walk(dir);
  return parts.join('|');
}

/** Where a graphic's page lives on disk, and the folder whose content keys its cache. */
export function graphicFile(projectDir: string, graphic: string): { file: string; folder: string } {
  const entry = graphicEntry(graphic);
  if (isLibraryGraphic(graphic)) {
    // templates may share assets in graphics-lib/_shared, so the whole library keys the cache
    return { file: join(GRAPHICS_LIB_DIR, entry.slice(GRAPHICS_LIB_PREFIX.length)), folder: GRAPHICS_LIB_DIR };
  }
  return { file: join(projectDir, entry), folder: join(projectDir, dirname(entry)) };
}

type GraphicRef = Pick<Clip, 'graphic' | 'out' | 'graphicData' | 'graphicEdits' | 'retime'>;

/** Open a graphic page at the 1080p authoring size, scaled to `width` output pixels. */
async function openGraphic(project: string, projectDir: string, c: GraphicRef, settings: Pick<Settings, 'aspect' | 'theme'>, width: number, isolated = false): Promise<Page> {
  const entry = graphicEntry(c.graphic!);
  if (!existsSync(graphicFile(projectDir, c.graphic!).file)) throw new Error(`graphic ${entry} not found`);
  const base = graphicBaseSize(settings);
  const browser = await getBrowser();
  const context = isolated ? await browser.createBrowserContext() : browser.defaultBrowserContext();
  const page = await context.newPage();
  try {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String((e as Error).message ?? e)));
    await page.setViewport({ width: base.width, height: base.height, deviceScaleFactor: width / base.width });
    await page.goto(`http://127.0.0.1:${PORT}${graphicUrl(project, c, base, settings.theme)}`, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.evaluate(GRAPHIC_RUNTIME);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    if (errors.length) throw new Error(`graphic ${entry}: ${errors[0]}`);
    return page;
  } catch (e) {
    if (isolated) await context.close(); else await page.close();
    throw e;
  }
}

const seek = (page: Page, t: number) => page.evaluate((s) => (window as unknown as { __graphicSeek: (t: number) => Promise<void> }).__graphicSeek(s), t);

export interface GraphicCaptureStats { frames: number; screenshots: number; reused: number; unique: number; pages: number; captureSeconds: number; encodeSeconds: number; sourceDigest?: string }

/** Adjacent equal PNGs become one timed packet; retain a final frame to bound the hold exactly. */
export function graphicFrameList(runs: { file: string; count: number }[], fps: number): string {
  return runs.flatMap(({ file, count }, i) => {
    const entry = (n: number) => [`file '${file}'`, `option framerate ${fps}`, `duration ${n / fps}`];
    return i === runs.length - 1 && count > 1 ? [...entry(count - 1), ...entry(1)] : entry(count);
  }).join('\n') + '\n';
}

async function renderOne(project: string, projectDir: string, c: Clip, settings: Settings, W: number, fps: number, rel: string, onFrame: () => void, signal: AbortSignal | undefined, samples: number, pages: number): Promise<GraphicCaptureStats> {
  const cache = join(projectDir, 'cache/graphics');
  assertNoLink(join(projectDir, 'cache')); assertNoLink(cache);
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(join(cache, 'capture-'));
  const k = Math.max(1, Math.round(samples));
  const frames = Math.max(1, Math.round(clipDuration(c) * fps));
  const workers = Math.max(1, Math.min(pages, Math.ceil(frames / 120)));
  const stats: GraphicCaptureStats = { frames, screenshots: 0, reused: 0, unique: 0, pages: workers, captureSeconds: 0, encodeSeconds: 0 };
  const started = performance.now();
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) ctrl.abort();
  const frameHashes: string[] = new Array(frames);
  try {
    const results = await Promise.allSettled(Array.from({ length: workers }, async (_, w) => {
      const page = await openGraphic(project, projectDir, c, settings, W, true).catch((e) => { ctrl.abort(); throw e; });
      try {
        let lastTime: number | undefined, lastPng: Uint8Array | undefined, lastHash = '', fastPng = true;
        const runs: { file: string; count: number }[] = [];
        const shot = async (t: number): Promise<Uint8Array> => {
          if (ctrl.signal.aborted) throw new Error('cancelled');
          const at = retimedToPage(c.retime, Math.max(c.in, Math.min(c.out, t)));
          const idle = lastPng && lastTime !== undefined && await page.evaluate((a, b) => (window as unknown as { __graphicIdle: (a: number, b: number) => boolean }).__graphicIdle(a, b), lastTime, at);
          if (idle) { stats.reused++; return lastPng!; }
          await seek(page, at);
          lastTime = at;
          lastPng = await page.screenshot({ type: 'png', omitBackground: true, optimizeForSpeed: fastPng });
          stats.screenshots++;
          // Keep transparent edges on the established capture path; fast PNGs help opaque footage.
          if (fastPng && lastPng[25] === 6) {
            fastPng = false;
            lastPng = await page.screenshot({ type: 'png', omitBackground: true });
            stats.screenshots++;
          }
          return lastPng;
        };
        const write = (png: Uint8Array) => {
          const hash = createHash('sha256').update(png).digest('hex');
          if (runs.length && hash === lastHash) { runs[runs.length - 1].count++; return hash; }
          const file = `${w}-${runs.length}.png`;
          writeFileSync(join(scratch, file), png);
          runs.push({ file, count: 1 }); lastHash = hash; stats.unique++;
          return hash;
        };
        const from = Math.floor(w * frames / workers), to = Math.floor((w + 1) * frames / workers);
        const shutter = (0.5 / fps) * c.speed;
        for (let i = from; i < to; i++) {
          const t = c.in + (i / fps) * c.speed;
          if (k === 1) frameHashes[i] = write(await shot(t));
          else {
            const at = (j: number) => t + ((j + 0.5) / k - 0.5) * shutter;
            const first = await shot(at(0)), last = await shot(at(k - 1));
            const still = Buffer.from(first).equals(Buffer.from(last));
            write(first);
            for (let j = 1; j < k - 1; j++) write(still ? first : await shot(at(j)));
            write(last);
          }
          onFrame();
        }
        const list = `${w}.txt`;
        writeFileSync(join(scratch, list), graphicFrameList(runs, fps * k));
        return { list, frames: to - from, w };
      } catch (e) { ctrl.abort(); throw e; }
      finally { await page.browserContext().close(); }
    }));
    stats.captureSeconds = (performance.now() - started) / 1000;
    if (k === 1) stats.sourceDigest = createHash('sha256').update(frameHashes.join('')).digest('hex');
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const encodeStart = performance.now();
    // Keep the previous 180° shutter averaging exactly, including all k samples in moving frames.
    await encodeGraphicParts(scratch, results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []), fps, k, ctrl.signal);
    assertNoLink(join(projectDir, rel));
    renameSync(join(scratch, 'joined.mkv'), join(projectDir, rel));
    stats.encodeSeconds = (performance.now() - encodeStart) / 1000;
    return stats;
  } finally {
    signal?.removeEventListener('abort', abort);
    assertWithin(cache, scratch);
    // Only our generated flat files; a link introduced while rendering is refused.
    assertNoLink(scratch);
    for (const f of readdirSync(scratch)) assertNoLink(join(scratch, f));
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function graphicCachePath(projectDir: string, c: Clip, settings: Settings, W: number, fps: number, samples = 1): string {
  const { folder } = graphicFile(projectDir, c.graphic!);
  const key = [GRAPHIC_CACHE_VERSION, graphicEntry(c.graphic!), folderKey(folder), c.graphicData ?? null, settings.theme, c.in, c.out, c.speed, settings.aspect, W, fps, { blur: Math.max(1, Math.round(samples)), edits: c.graphicEdits ?? null, retime: c.retime ?? null }];
  return `cache/graphics/${createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16)}.rgba.mkv`;
}

/** Render every graphic clip to a transparent video (cached). Returns clipId -> project-relative path. */
export async function renderGraphics(
  project: string, projectDir: string, clips: Clip[], settings: Settings, W: number, fps: number,
  onProgress?: (p: number) => void, signal?: AbortSignal, samples = 1,
  options: { pages?: number; onStats?: (stats: GraphicCaptureStats) => void } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo: { clip: Clip; rel: string; frames: number }[] = [];
  assertNoLink(join(projectDir, 'cache')); assertNoLink(join(projectDir, 'cache/graphics'));
  for (const c of clips) {
    if (!c.graphic) continue;
    const entry = graphicEntry(c.graphic);
    const { file } = graphicFile(projectDir, c.graphic);
    if (!existsSync(file)) throw new Error(`graphic ${entry} not found (clip ${c.id})`);
    const rel = graphicCachePath(projectDir, c, settings, W, fps, samples);
    assertNoLink(join(projectDir, rel));
    out.set(c.id, rel);
    if (!existsSync(join(projectDir, rel)) && !todo.some((x) => x.rel === rel)) todo.push({ clip: c, rel, frames: Math.max(1, Math.round(clipDuration(c) * fps)) });
  }
  const total = todo.reduce((s, x) => s + x.frames, 0);
  let done = 0;
  const pages = Math.max(1, Math.min(4, availableParallelism(), Math.floor(options.pages ?? Math.max(1, availableParallelism() / 2))));
  for (const { clip, rel } of todo) {
    const stats = await renderOne(project, projectDir, clip, settings, W, fps, rel, () => onProgress?.(++done / total), signal, samples, pages);
    options.onStats?.(stats);
  }
  for (const rel of new Set(out.values())) { const file = join(projectDir, rel); const s = statSync(file); utimesSync(file, new Date(), s.mtime); }
  return out;
}

/**
 * PNG stills of a graphic page at the given page times; returns file paths (tmpDir/<prefix>NNN.png).
 * backdrop: over a dark background (to look at it alone) instead of transparent (to composite it).
 */
export async function graphicStills(
  project: string, projectDir: string, c: GraphicRef, settings: Pick<Settings, 'aspect' | 'theme'>, times: number[], width: number, tmpDir: string,
  { backdrop = true, prefix = 'g' }: { backdrop?: boolean; prefix?: string } = {},
): Promise<string[]> {
  const page = await openGraphic(project, projectDir, c, settings, width);
  try {
    if (backdrop) await page.evaluate(() => { document.documentElement.style.background = '#2b2f38'; });
    mkdirSync(tmpDir, { recursive: true });
    const files: string[] = [];
    for (const [i, t] of times.entries()) {
      await seek(page, t);
      const f = join(tmpDir, `${prefix}${String(i).padStart(3, '0')}.png`);
      writeFileSync(f, await page.screenshot({ type: 'png', omitBackground: !backdrop }));
      files.push(f);
    }
    return files;
  } finally {
    await page.close();
  }
}
