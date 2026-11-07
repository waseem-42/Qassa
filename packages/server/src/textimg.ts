import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { createRequire } from 'node:module';
import puppeteer, { type Browser } from 'puppeteer-core';
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

/**
 * Render every text clip to a full-frame transparent PNG (cached by content). Returns clipId -> project-relative path.
 * `active`: the lit word of each highlighted-caption piece (expandHighlights).
 */
export async function renderTextImages(projectDir: string, clips: Clip[], W: number, H: number, theme?: Theme, active?: Map<string, number>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo: { clip: Clip; rel: string }[] = [];
  for (const c of clips) {
    if (!c.text) continue;
    const lit = active?.get(c.id);
    const hash = createHash('sha1').update(JSON.stringify([c.text, c.textStyle, theme ?? null, W, H, 3, ...(lit === undefined ? [] : [lit])])).digest('hex').slice(0, 16);
    const rel = `cache/text/${hash}.png`;
    out.set(c.id, rel);
    if (!existsSync(join(projectDir, rel))) todo.push({ clip: c, rel });
  }
  if (!todo.length) return out;
  mkdirSync(join(projectDir, 'cache/text'), { recursive: true });
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    // setContent has no file origin: embed just the fonts this render uses.
    const css = fontFaceCss(undefined, [...new Set(['IBM Plex Sans Arabic', theme?.font ?? '', ...todo.map(({ clip }) => clip.textStyle?.font ?? '')])]);
    for (const { clip, rel } of todo) {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden}</style></head><body><div style="position:relative;width:${W}px;height:${H}px">${textLayerHtml(clip, H, theme, active?.get(clip.id))}</div></body></html>`,
        { waitUntil: 'load' },
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(projectDir, rel) as `${string}.png`, omitBackground: true, type: 'png' });
    }
  } finally {
    await page.close();
  }
  return out;
}
