import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from 'puppeteer-core';
import { FFMPEG } from '@edit/render';
import {
  GRAPHIC_RUNTIME, GRAPHICS_LIB_PREFIX, clipDuration, graphicBaseSize, graphicEntry, graphicUrl, isLibraryGraphic, retimedToPage, type Clip, type Settings,
} from '@edit/shared';
import { GRAPHICS_LIB_DIR, PORT } from './config.ts';
import { getBrowser } from './textimg.ts';

// HTML graphics are rendered by stepping the page's clock frame by frame in the headless browser
// and piping the screenshots into a transparent PNG-in-MOV, cached by the folder's content.

const VERSION = 1;

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
async function openGraphic(project: string, projectDir: string, c: GraphicRef, settings: Pick<Settings, 'aspect' | 'theme'>, width: number): Promise<Page> {
  const entry = graphicEntry(c.graphic!);
  if (!existsSync(graphicFile(projectDir, c.graphic!).file)) throw new Error(`graphic ${entry} not found`);
  const base = graphicBaseSize(settings);
  const page = await (await getBrowser()).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String((e as Error).message ?? e)));
  await page.setViewport({ width: base.width, height: base.height, deviceScaleFactor: width / base.width });
  await page.goto(`http://127.0.0.1:${PORT}${graphicUrl(project, c, base, settings.theme)}`, { waitUntil: 'networkidle0', timeout: 30_000 });
  await page.evaluate(GRAPHIC_RUNTIME);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (errors.length) {
    await page.close();
    throw new Error(`graphic ${entry}: ${errors[0]}`);
  }
  return page;
}

const seek = (page: Page, t: number) => page.evaluate((s) => (window as unknown as { __graphicSeek: (t: number) => Promise<void> }).__graphicSeek(s), t);

async function renderOne(project: string, projectDir: string, c: Clip, settings: Settings, W: number, fps: number, rel: string, onFrame: () => void, signal?: AbortSignal, samples = 1) {
  const page = await openGraphic(project, projectDir, c, settings, W);
  const tmp = rel.replace(/\.mov$/, '.part.mov');
  mkdirSync(join(projectDir, dirname(rel)), { recursive: true });
  const k = Math.max(1, Math.round(samples));
  // motion blur: k shots per frame across a 180° shutter, averaged by ffmpeg (tmix over each group of k, keep the last of each group)
  const blur = k > 1 ? ['-vf', `tmix=frames=${k},select=eq(mod(n\\,${k})\\,${k - 1}),setpts=N/(${fps}*TB)`, '-c:v', 'png', '-pix_fmt', 'rgba', '-r', String(fps)] : ['-c:v', 'copy'];
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps * k), '-c:v', 'png', '-i', '-', ...blur, tmp], { cwd: projectDir, windowsHide: true });
  let err = '';
  ff.stderr.setEncoding('utf8').on('data', (s: string) => (err = (err + s).slice(-2000)));
  const closed = new Promise<number | null>((res) => ff.on('close', res));
  try {
    const frames = Math.max(1, Math.round(clipDuration(c) * fps));
    const write = async (png: Uint8Array) => { if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r)); };
    const shot = async (t: number) => { await seek(page, retimedToPage(c.retime, Math.max(c.in, Math.min(c.out, t)))); return page.screenshot({ type: 'png', omitBackground: true }); };
    const shutter = (0.5 / fps) * c.speed; // 180°: the shutter is open for half a frame
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new Error('cancelled');
      const t = c.in + (i / fps) * c.speed;
      if (k === 1) {
        await write(await shot(t));
      } else {
        const at = (j: number) => t + ((j + 0.5) / k - 0.5) * shutter;
        const first = await shot(at(0)), last = await shot(at(k - 1));
        // nothing moves in this frame: no need for the shots in between
        const still = Buffer.from(first).equals(Buffer.from(last));
        await write(first);
        for (let j = 1; j < k - 1; j++) await write(still ? first : await shot(at(j)));
        await write(last);
      }
      onFrame();
    }
    ff.stdin.end();
    if ((await closed) !== 0) throw new Error(`ffmpeg (graphic): ${err.trim()}`);
    renameSync(join(projectDir, tmp), join(projectDir, rel));
  } catch (e) {
    ff.kill('SIGKILL');
    rmSync(join(projectDir, tmp), { force: true });
    throw e;
  } finally {
    await page.close();
  }
}

/** Render every graphic clip to a transparent video (cached). Returns clipId -> project-relative path. */
export async function renderGraphics(
  project: string, projectDir: string, clips: Clip[], settings: Settings, W: number, fps: number,
  onProgress?: (p: number) => void, signal?: AbortSignal, samples = 1,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo: { clip: Clip; rel: string; frames: number }[] = [];
  for (const c of clips) {
    if (!c.graphic) continue;
    const entry = graphicEntry(c.graphic);
    const { file, folder } = graphicFile(projectDir, c.graphic);
    if (!existsSync(file)) throw new Error(`graphic ${entry} not found (clip ${c.id})`);
    const key: unknown[] = [VERSION, entry, folderKey(folder), c.graphicData ?? null, settings.theme, c.in, c.out, c.speed, settings.aspect, W, fps];
    if (samples > 1) key.push({ blur: samples }); // unblurred renders keep their old cache entries
    if (c.graphicEdits?.length || c.retime) key.push({ edits: c.graphicEdits ?? null, retime: c.retime ?? null });
    const rel = `cache/graphics/${createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16)}.mov`;
    out.set(c.id, rel);
    if (!existsSync(join(projectDir, rel)) && !todo.some((x) => x.rel === rel)) todo.push({ clip: c, rel, frames: Math.max(1, Math.round(clipDuration(c) * fps)) });
  }
  const total = todo.reduce((s, x) => s + x.frames, 0);
  let done = 0;
  for (const { clip, rel } of todo) await renderOne(project, projectDir, clip, settings, W, fps, rel, () => onProgress?.(++done / total), signal, samples);
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
