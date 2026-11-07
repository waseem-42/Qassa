import { afterAll, beforeAll, expect, it } from 'vitest';
import { GRAPHIC_RUNTIME } from '@edit/shared';
import { closeBrowser, fontFaceCss, getBrowser, launchBrowser } from '../src/textimg.ts';
import { readyGraphicFonts, settleGraphicPaint } from '../src/graphics.ts';

// Launch the shared browser outside the tests' own time limits.
beforeAll(async () => { await getBrowser(); }, 60_000);
afterAll(closeBrowser);
it('loads unused faces before a later worker measures its first title', async () => {
  // One page per browser process, as in the renderer: a background tab in a shared process can stall
  // its screenshots when the machine is busy (seen on cold, fully parallel test runs).
  const other = await launchBrowser();
  const a = await (await getBrowser()).newPage(), b = await other.newPage();
  try {
    const html = `<style>${fontFaceCss(undefined, ['IBM Plex Sans Arabic'])}body{margin:0}</style><svg width="480" height="120"></svg><script>
      const canvas = document.createElement('canvas').getContext('2d'), widths = new Map();
      window.renderFrame = t => {
        if (t < 1) return;
        const text = 'منذ نعومة أظفارنا';
        if (!widths.has(text)) { canvas.font = '600 48px "IBM Plex Sans Arabic"'; widths.set(text, canvas.measureText(text).width); }
        document.querySelector('svg').innerHTML = '<rect width="' + widths.get(text) + '" height="110" fill="#cb9528"/><text y="65" font-family="IBM Plex Sans Arabic" font-weight="600" font-size="48">' + text + '</text>';
      };
    </script>`;
    for (const page of [a, b]) {
      await page.setViewport({ width: 480, height: 120 });
      await page.setContent(html);
      await page.evaluate(GRAPHIC_RUNTIME);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => Array.from(document.fonts).some(f => f.status === 'unloaded'))).toBe(true);
      await readyGraphicFonts(page);
    }
    await a.evaluate(() => (window as any).__graphicSeek(1));
    await a.screenshot({ type: 'png', omitBackground: true });
    for (const page of [a, b]) await page.evaluate(() => (window as any).__graphicSeek(2));
    const reference = await a.screenshot({ type: 'png', omitBackground: true });
    const laterWorker = await b.screenshot({ type: 'png', omitBackground: true });
    expect(Buffer.from(laterWorker).equals(Buffer.from(reference))).toBe(true);
  } finally { await a.close(); await other.close(); }
}, 30_000);

it('settles active paints and falls back when animation frames are throttled', async () => {
  const page = await (await getBrowser()).newPage();
  try {
    expect(await settleGraphicPaint(page)).toBe(true);
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    expect(await settleGraphicPaint(page)).toBe(false);
    await page.evaluate(() => { window.requestAnimationFrame = () => { throw new Error('unavailable'); }; });
    expect(await settleGraphicPaint(page)).toBe(false);
  } finally { await page.close(); }
}, 15_000);
