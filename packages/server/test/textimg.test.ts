import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { Clip, Theme } from '@edit/shared';
import { closeBrowser, renderTextImages } from '../src/textimg.ts';

const root = mkdtempSync(join(tmpdir(), 'qassa-textimg-'));
afterAll(async () => { await closeBrowser();rmSync(root, { recursive: true, force: true }); });
const clip = (id: string, text = 'كلمات تضيء هنا') => Clip.parse({ id, trackId: 'T1', start: 0, in: 0, out: 3, text, textStyle: { preset: 'caption', highlight: '#f2b33d' } });

it('keeps existing cache keys, counts duplicate clips once per output and reports cache hits', async () => {
  const clips = [clip('a'), clip('b'), clip('lit0'), clip('lit1')], theme = Theme.parse({}), active = new Map([['lit0', 0], ['lit1', 1]]);
  const progress: number[][] = [], out = await renderTextImages(root, clips, 640, 360, theme, active, { onProgress: (done, total) => progress.push([done, total]) });
  const key = createHash('sha1').update(JSON.stringify([clips[0].text, clips[0].textStyle, theme, 640, 360, 3])).digest('hex').slice(0, 16);
  expect(out.get('a')).toBe(`cache/text/${key}.png`);expect(out.get('b')).toBe(out.get('a'));
  expect(new Set(out.values()).size).toBe(3);expect(out.get('lit0')).not.toBe(out.get('lit1'));
  expect(progress[0]).toEqual([0, 4]);expect(progress.at(-1)).toEqual([4, 4]);
  const before = [...out.values()].map((rel) => statSync(join(root, rel)).mtimeMs);
  for (const rel of out.values()) expect(readFileSync(join(root, rel)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const hits: number[][] = [];await renderTextImages(root, clips, 640, 360, theme, active, { onProgress: (done, total) => hits.push([done, total]) });
  expect(hits).toEqual([[4, 4]]);expect([...out.values()].map((rel) => statSync(join(root, rel)).mtimeMs)).toEqual(before);
}, 60_000);

it('stops after cancellation, leaves completed cache entries usable, and resumes the missing work', async () => {
  const clips = [clip('cancel-a', 'نص الإلغاء الأول'), clip('cancel-b', 'نص الإلغاء الثاني')], ctrl = new AbortController(), dir = join(root, 'cancel');
  await expect(renderTextImages(dir, clips, 640, 360, undefined, undefined, { signal: ctrl.signal, onProgress: (done) => { if (done) ctrl.abort(); } })).rejects.toThrow('cancelled');
  const progress: number[][] = [];const out = await renderTextImages(dir, clips, 640, 360, undefined, undefined, { onProgress: (done, total) => progress.push([done, total]) });
  expect(out.size).toBe(2);expect(progress).toEqual([[1, 2], [2, 2]]);
  await expect(renderTextImages(dir, clips, 640, 360, undefined, undefined, { signal: ctrl.signal })).rejects.toThrow();
}, 60_000);
