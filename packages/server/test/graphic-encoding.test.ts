import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG } from '@edit/render';
import { encodeGraphicParts } from '../src/graphic-encoding.ts';
import { graphicFrameList } from '../src/graphics.ts';

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) { if (!relative(resolve(tmpdir()), dir).startsWith('qassa-graphic-encode-')) throw new Error('unsafe cleanup'); rmSync(dir, { recursive: true, force: true }); } });
const ff = (args: string[], cwd: string) => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { cwd, windowsHide: true, maxBuffer: 4 * 1024 ** 2 });
  expect(result.status, String(result.stderr)).toBe(0); return result.stdout;
};

it('keeps every alpha sample and exact holds across independently encoded ranges and the last blurred frame', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qassa-graphic-encode-')); roots.push(dir);
  for (const [name, opacity] of [['a', .25], ['b', .75]] as const) ff(['-f', 'lavfi', '-i', `color=c=red@${opacity}:s=64x64:r=30,format=rgba`, '-frames:v', '1', `${name}.png`], dir);
  const values = ['a', 'b'].map((name) => ff(['-i', `${name}.png`, '-vf', 'alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], dir)[0]);
  const alpha = () => ff(['-i', 'joined.mkv', '-map', '0:v:1', '-vf', 'fps=30', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], dir);
  writeFileSync(join(dir, '0.txt'), graphicFrameList([{ file: 'a.png', count: 11 }], 30));
  writeFileSync(join(dir, '1.txt'), graphicFrameList([{ file: 'b.png', count: 13 }], 30));
  await encodeGraphicParts(dir, [{ w: 0, list: '0.txt', frames: 11 }, { w: 1, list: '1.txt', frames: 13 }], 30, 1);
  let decoded = alpha(); expect(decoded.length).toBe(64 * 64 * 24);
  for (let i = 0; i < 24; i++) expect(new Set(decoded.subarray(i * 4096, (i + 1) * 4096))).toEqual(new Set([values[i < 11 ? 0 : 1]]));
  for (const name of ['joined.mkv', '0.mkv', '1.mkv']) rmSync(join(dir, name));
  writeFileSync(join(dir, '0.txt'), graphicFrameList([{ file: 'a.png', count: 4 }, { file: 'b.png', count: 4 }], 120));
  await encodeGraphicParts(dir, [{ w: 0, list: '0.txt', frames: 2 }], 30, 4);
  decoded = alpha(); expect(decoded.length).toBe(64 * 64 * 2);
  expect(new Set(decoded.subarray(0, 4096))).toEqual(new Set([values[0]]));
  expect(new Set(decoded.subarray(4096))).toEqual(new Set([values[1]]));
}, 30_000);
