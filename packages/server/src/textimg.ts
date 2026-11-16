import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { textLayerHtml, THEME_FONTS, type Clip, type Theme } from '@edit/shared';
import { brands } from './brands.ts';
import { BROWSER, ROOT } from './config.ts';

// Text overlays are rendered by a headless browser from the exact markup the editor preview
// uses, so what you see in the editor is what lands in the video.

const require = createRequire(join(ROOT, 'packages/app/package.json'));

/** The font files of every project font (THEME_FONTS), for pages rendered outside the editor bundle. */
export function fontFiles(): { family: string; file: string; weight: number; latin: boolean }[] {
  const manifest = join(ROOT, 'fonts/manifest.json');
  const bundled = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { family: string; file: string; weight: number; latin: boolean }[]).map((f) => ({ ...f, file: join(ROOT, 'fonts', f.file) })) : THEME_FONTS.flatMap(({ family, pkg }) => {
    try {
      const dir = join(dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files');
      const name = new RegExp(`^${pkg}-(arabic|latin)-(\\d+)-normal\\.woff2$`);
      return readdirSync(dir).flatMap((f) => {
        const m = f.match(name);
        return m ? [{ family, file: join(dir, f), weight: Number(m[2]), latin: m[1] === 'latin' }] : [];
      });
    } catch {
      return []; // not installed: texts in it fall back to the default stack
    }
  });
  return [...bundled, ...brands.list().flatMap((kit) => kit.fonts.map((f) => ({ family: f.family, file: brands.file(kit.id, f.file), weight: 400, latin: false })))];
}

/** @font-face rules; url(f) maps a font file to the URL the page should load it from. */
export function fontFaceCss(url: (file: string) => string = (f) => `data:font/${extname(f).slice(1)};base64,${readFileSync(f).toString('base64')}`, families?: string[]): string {
  return fontFiles().filter((f) => !families || families.includes(f.family))
    .map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url('${url(f.file)}');${f.latin ? 'unicode-range:U+0000-00FF;' : ''}}`)
    .join('\n');
}

let browser: Promise<Browser> | undefined;
/** A fresh browser process with the same settings as the shared one (pages of one process paint one at a time). */
export function launchBrowser(): Promise<Browser> {
  if (!BROWSER) throw new Error('no Chrome or Edge found for text rendering (set EDIT_BROWSER)');
  return puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--allow-file-access-from-files', '--disable-gpu'] });
}
export function getBrowser(): Promise<Browser> {
  browser ??= launchBrowser();
  return browser;
}

export async function closeBrowser() {
  if (browser) await (await browser).close().catch(() => {});
  browser = undefined;
}

interface TextRenderOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Render every text clip to a full-frame transparent PNG (cached by content). Returns clipId -> project-relative path.
 * `active`: the lit word of each highlighted-caption piece (expandHighlights).
 */
export async function renderTextImages(projectDir: string, clips: Clip[], W: number, H: number, theme?: Theme, active?: Map<string, number>, options: TextRenderOptions = {}): Promise<Map<string, string>> {
  options.signal?.throwIfAborted();
  const out = new Map<string, string>();
  const missing = new Map<string, { clip: Clip; rel: string; count: number }>();
  for (const c of clips) {
    if (!c.text) continue;
    const lit = active?.get(c.id);
    const hash = createHash('sha1').update(JSON.stringify([c.text, c.textStyle, theme ?? null, W, H, 3, ...(lit === undefined ? [] : [lit])])).digest('hex').slice(0, 16);
    const rel = `cache/text/${hash}.png`;
    out.set(c.id, rel);
    if (!existsSync(join(projectDir, rel))) {
      const old = missing.get(rel);
      if (old) old.count++;
      else missing.set(rel, { clip: c, rel, count: 1 });
    }
  }
  const todo = [...missing.values()];
  let done = out.size - todo.reduce((n, item) => n + item.count, 0);
  options.onProgress?.(done, out.size);
  if (!todo.length) return out;
  mkdirSync(join(projectDir, 'cache/text'), { recursive: true });
  const css = fontFaceCss(undefined, [...new Set(['IBM Plex Sans Arabic', theme?.font ?? '', ...todo.map(({ clip }) => clip.textStyle?.font ?? '')])]);
  const workers = Math.min(4, availableParallelism(), Math.ceil(todo.length / 16));
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) ctrl.abort();
  let next = 0;
  try {
    const results = await Promise.allSettled(Array.from({ length: workers }, async (_, w) => {
      let own: Browser | undefined;
      let page: Page | undefined;
      try {
        if (ctrl.signal.aborted) throw new Error('cancelled');
        // Separate processes paint concurrently; the first worker reuses the shared browser.
        const b = w === 0 ? await getBrowser() : (own = await launchBrowser());
        page = await b.newPage();
        await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
        await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden}</style></head><body><div id="text-layer" style="position:relative;width:${W}px;height:${H}px"></div></body></html>`, { waitUntil: 'load' });
        // Load even unused weights/subsets before swapping text; keep the existing fallback for failed faces.
        await page.evaluate(async () => { await Promise.all([...document.fonts].map((f) => f.load().catch(() => {}))); await document.fonts.ready; });
        while (next < todo.length) {
          if (ctrl.signal.aborted) throw new Error('cancelled');
          const { clip, rel, count } = todo[next++];
          await page.evaluate(async (html) => { document.getElementById('text-layer')!.innerHTML = html; await document.fonts.ready; }, textLayerHtml(clip, H, theme, active?.get(clip.id)));
          await page.screenshot({ path: join(projectDir, rel) as `${string}.png`, omitBackground: true, type: 'png', optimizeForSpeed: true });
          done += count;
          options.onProgress?.(done, out.size);
        }
      } catch (e) { ctrl.abort(); throw e; }
      finally { await page?.close().catch(() => {}); await own?.close().catch(() => {}); }
    }));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    if (ctrl.signal.aborted) throw new Error('cancelled');
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
  return out;
}
