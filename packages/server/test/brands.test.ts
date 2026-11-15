import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Brands, parseBrand } from '../src/brands.ts';

const fixture = (name: string) => ({ name, text: readFileSync(new URL(`./fixtures/brands/${name}`, import.meta.url), 'utf8') });
describe('brand extraction', () => {
  it('reads CSS tokens, font and direction', () => {
    expect(parseBrand([fixture('tokens.css')]).theme).toEqual({ accent: '#aa5533', accent2: '#33aacc', panel: '#111222', text: '#eeeeff', font: 'Cairo', direction: 'rtl' });
  });
  it('reads W3C references, flat JSON colours and font families', () => {
    expect(parseBrand([fixture('tokens.json')])).toMatchObject({ name: 'Token kit', theme: { accent: '#ccaa22', panel: '#123456', text: '#ffffff', font: 'Tajawal' } });
  });
  it('reads markdown colour names and voice', () => {
    expect(parseBrand([fixture('brand.md')])).toMatchObject({ name: 'هوية الاختبار', theme: { accent: '#ed7733', accent2: '#33bbcc', panel: '#112233', text: '#eeeeee' }, notes: 'بسيطة وواضحة' });
  });
  it('reads messy HTML without executing it', () => {
    expect(parseBrand([fixture('messy.html')]).theme).toMatchObject({ accent: '#991155', accent2: '#55ccaa', panel: '#101020', text: '#eeeeff', font: 'Almarai' });
  });
  it('embeds selected fonts so the originless text renderer can load them', async () => {
    const { fontFaceCss, getBrowser, closeBrowser } = await import('../src/textimg.ts');
    const css = fontFaceCss(undefined, ['Cairo']);
    expect(css).toContain('data:font/woff2;base64,'); expect(css).not.toContain('file:');
    expect(css).not.toContain("font-family:'Tajawal'");
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(`<style>${css}</style><p style="font-family:Cairo">حروف عربية</p>`);
      expect(await page.evaluate(async () => { await document.fonts.load('26px Cairo'); return [...document.fonts].some((f) => f.family === 'Cairo' && f.status === 'loaded'); })).toBe(true);
      await page.close();
    } finally { await closeBrowser(); }
  }, 60_000); // a cold browser launch under the full parallel suite takes far longer than alone (~2 s)
  it('stores reusable kits, confines archive paths, and maps font-face files', () => {
    const root = mkdtempSync(join(tmpdir(), 'qassa-brands-'));
    try {
      const kits = new Brands(root);
      const kit = kits.upload('tokens.css', Buffer.from(fixture('tokens.css').text));
      expect(kits.list()).toHaveLength(1); expect(kits.read(kit.id).source).toBe('tokens.css');
      expect(existsSync(kits.file(kit.id, 'original.css'))).toBe(true);
      expect(() => kits.file(kit.id, '../outside')).toThrow('unsafe');
      expect(() => kits.read('../outside')).toThrow('invalid brand ID');
      const zip = spawnSync('python', ['-c', "import io,zipfile,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('../../logo.svg','<svg xmlns=\"http://www.w3.org/2000/svg\"/>'); z.writestr('fonts/test.woff2',b'font'); z.writestr('tokens.css',':root{--primary:#aabbcc} @font-face{font-family:Test Font;src:url(fonts/test.woff2)}'); z.close(); sys.stdout.buffer.write(b.getvalue())"]);
      expect(zip.status).toBe(0);
      const zipped = kits.upload('kit.zip', zip.stdout);
      expect(zipped.logos).toHaveLength(1); expect(zipped.fonts[0].family).toBe('Test Font');
      expect(zipped.theme.accent).toBe('#aabbcc');
      expect(zipped.logos[0]).toMatch(/^assets\//); expect(existsSync(kits.file(zipped.id, zipped.logos[0]))).toBe(true);
      expect(() => kits.save({ ...kit, theme: { font: "x'; color:red" } })).toThrow();
    } finally {
      if (!relative(resolve(tmpdir()), root).startsWith('qassa-brands-')) throw new Error('unsafe cleanup');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
