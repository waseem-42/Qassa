import { afterAll, expect, it } from 'vitest';
import { GRAPHIC_RUNTIME } from '@edit/shared';
import { closeBrowser, getBrowser } from '../src/textimg.ts';

afterAll(closeBrowser);
it('idle reuse is pixel-exact across CSS holds, delay/exit boundaries and visibility windows', async () => {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport({ width: 160, height: 120 });
    await page.setContent(`<style>body{margin:0}div{width:90px;height:80px;background:#eab342;animation:in .2s .2s both,out .2s 1.5s both}@keyframes in{from{opacity:0;transform:translateX(10px)}}@keyframes out{to{opacity:0}}</style><div></div><span data-start=".9" data-duration=".2">window</span>`);
    await page.evaluate(GRAPHIC_RUNTIME);
    const seek = (t: number) => page.evaluate((s) => (window as any).__graphicSeek(s), t);
    const idle = (a: number, b: number) => page.evaluate((from, to) => (window as any).__graphicIdle(from, to), a, b);
    let previous: Uint8Array | undefined, prior = 0, reused = 0;
    for (let i = 0; i < 60; i++) {
      const t = i / 30;
      const reuse = previous && await idle(prior, t);
      await seek(t);
      const actual = await page.screenshot({ type: 'png', omitBackground: true });
      if (reuse) { expect(Buffer.from(actual).equals(Buffer.from(previous!)), `frame ${i}`).toBe(true); reused++; }
      previous = actual; prior = t;
    }
    expect(reused).toBeGreaterThan(25);
    expect(await idle(.1, .3)).toBe(false);
    expect(await idle(.8, .9)).toBe(false);
    await page.setViewport({ width: 160, height: 120, deviceScaleFactor: .5 });
    expect(await idle(2, 3)).toBe(false);
    await page.setViewport({ width: 160, height: 120, deviceScaleFactor: 1 });
    await page.evaluate(() => { (window as any).renderFrame = () => {}; });
    expect(await idle(2, 3)).toBe(false);
    await page.evaluate(() => { delete (window as any).renderFrame; document.body.append(document.createElement('canvas')); });
    expect(await idle(2, 3)).toBe(false);
  } finally { await page.close(); }
}, 30_000);
