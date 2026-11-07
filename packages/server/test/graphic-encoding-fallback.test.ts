import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG } from '@edit/render';
import { encodeGraphicParts } from '../src/graphic-encoding.ts';

const attempts = vi.hoisted(() => [] as string[]);
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const index = args[1]?.indexOf('-preset:v:0') ?? -1;
    const preset = index >= 0 ? args[1]![index + 1] : undefined;
    if (preset) attempts.push(preset);
    if (preset !== 'superfast') return actual.spawn(...args);
    const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: () => true });
    queueMicrotask(() => child.emit('close', 1));
    return child;
  } };
});

const roots: string[] = [];
afterEach(() => {
  attempts.length = 0;
  for (const dir of roots.splice(0)) {
    if (!relative(resolve(tmpdir()), dir).startsWith('qassa-graphic-fallback-')) throw new Error('unsafe cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
});

it('retries a failed faster encoder with the original encoder and preserves alpha', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qassa-graphic-fallback-')); roots.push(dir);
  const image = spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.25:s=64x64,format=rgba', '-frames:v', '1', 'a.png'], { cwd: dir, windowsHide: true });
  expect(image.status, String(image.stderr)).toBe(0);
  writeFileSync(join(dir, '0.txt'), "file 'a.png'\noption framerate 30\nduration 0.03333333333333333\n");
  expect(await encodeGraphicParts(dir, [{ list: '0.txt', frames: 1, w: 0 }], 30, 1, undefined, true)).toEqual({ fallbacks: 1 });
  expect(attempts).toEqual(['superfast', 'fast']);
  const alpha = spawnSync(FFMPEG, ['-v', 'error', '-i', 'joined.mkv', '-map', '0:v:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { cwd: dir, windowsHide: true });
  expect(alpha.status, String(alpha.stderr)).toBe(0);
  expect(alpha.stdout.length).toBe(4096);
  expect(new Set(alpha.stdout)).toEqual(new Set([63]));
}, 15_000);

it('does not retry or launch an encoder after cancellation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qassa-graphic-fallback-')); roots.push(dir);
  const ctrl = new AbortController(); ctrl.abort();
  await expect(encodeGraphicParts(dir, [{ list: 'missing.txt', frames: 1, w: 0 }], 30, 1, ctrl.signal, true)).rejects.toThrow('cancelled');
  expect(attempts).toEqual([]);
});
