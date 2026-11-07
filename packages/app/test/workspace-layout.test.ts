import { afterEach, expect, it, vi } from 'vitest';
import { readSplit, saveSplit, SPLIT_KEY, timelineSize } from '../src/lib/workspace-layout.ts';

afterEach(() => vi.unstubAllGlobals());

it('keeps a usable viewer and timeline, while allowing more track space on all three laptop sizes', () => {
  for (const available of [672, 720, 756, 816]) {
    const normal = timelineSize(available, .4), large = timelineSize(available, .9), max = timelineSize(available, .4, true);
    expect(normal).toBeGreaterThanOrEqual(160);
    expect(available - normal).toBeGreaterThanOrEqual(220);
    expect(large).toBe(max);
    expect(large).toBeGreaterThan(normal);
    expect(available - max).toBe(220);
    expect(timelineSize(available, 0)).toBe(160);
  }
});

it('restores the ratio across screen sizes, and migrates only usable old heights', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  expect(readSplit(672)).toBe(.4);
  values.set('timeline-height', '508'); expect(readSplit(672)).toBe(.4);
  values.set('timeline-height', '220'); expect(readSplit(672)).toBeCloseTo(220 / 672);
  saveSplit(.53); expect(values.get(SPLIT_KEY)).toBe('0.53'); expect(readSplit(816)).toBe(.53);
  expect(timelineSize(816, readSplit(816))).toBe(432);
  for (const bad of ['NaN', '-1', '2']) { values.set(SPLIT_KEY, bad); expect(readSplit(672)).toBeCloseTo(220 / 672); }
});

it('layout still works when viewer storage is denied', () => {
  vi.stubGlobal('localStorage', { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  expect(readSplit(672)).toBe(.4); expect(() => saveSplit(.5)).not.toThrow();
});
