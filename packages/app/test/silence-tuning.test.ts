import { expect, it, vi, afterEach } from 'vitest';
import { applyOps, defaultTracks, mainDuration, Project, reviewSavings } from '@edit/shared';
import { acceptOps, readTuning, saveTuning, tunedRanges, tunedSavings } from '../src/lib/silence-tuning.ts';

afterEach(() => vi.unstubAllGlobals());

const project = () => Project.parse({
  name: 'silence', createdAt: '', tracks: defaultTracks(),
  media: [{ id: 'm', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 20 }],
  clips: [{ id: 'a', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 20 }],
  suggestions: [
    { id: 's1', mediaId: 'm', t0: 2, t1: 2.4, reason: 'silence', author: 'analysis' },
    { id: 's2', mediaId: 'm', t0: 5, t1: 7, reason: 'silence', author: 'analysis' },
    { id: 'r1', mediaId: 'm', t0: 10, t1: 12, reason: 'retake', author: 'analysis' },
  ],
});

it('without tuning, accepting is the plain accept', () => {
  const p = project();
  const next = applyOps(p, acceptOps(p.suggestions, { min: 0, pad: 0 }));
  expect(mainDuration(next)).toBeCloseTo(20 - 0.4 - 2 - 2);
  expect(next.suggestions).toEqual([]);
});

it('a minimum length keeps short silences as suggestions and never touches other reasons', () => {
  const p = project(), t = { min: 1, pad: 0 };
  expect(tunedRanges(p.suggestions, t).map((s) => s.id)).toEqual(['s2', 'r1']);
  const next = applyOps(p, acceptOps(p.suggestions, t));
  expect(mainDuration(next)).toBeCloseTo(16);
  expect(next.suggestions.map((s) => s.id)).toEqual(['s1']);
});

it('padding leaves breathing room at both edges, in one batch, and the savings preview matches', () => {
  const p = project(), t = { min: 0, pad: 0.15 };
  const ranges = tunedRanges(p.suggestions, t);
  expect(ranges.find((s) => s.id === 's2')).toMatchObject({ t0: 5.15, t1: 6.85 });
  const next = applyOps(p, acceptOps(p.suggestions, t));
  expect(mainDuration(next)).toBeCloseTo(20 - reviewSavings(p, ranges));
  expect(mainDuration(next)).toBeCloseTo(20 - 0.1 - 1.7 - 2);
  expect(next.suggestions).toEqual([]);
  // a silence shorter than the two pads is left alone
  expect(tunedRanges(p.suggestions, { min: 0, pad: 0.25 }).map((s) => s.id)).toEqual(['s2', 'r1']);
});

it('remembers the tuning per viewer, and survives broken or denied storage', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
  saveTuning({ min: 0.8, pad: 0.1 });
  expect(readTuning()).toEqual({ min: 0.8, pad: 0.1 });
  values.set('qassa.silence-tuning', '{"min":99,"pad":"x"}');
  expect(readTuning()).toEqual({ min: 3, pad: 0 });
  vi.stubGlobal('localStorage', { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  expect(readTuning()).toEqual({ min: 0, pad: 0 });
  expect(() => saveTuning({ min: 1, pad: 0 })).not.toThrow();
});

it('speeding silences up keeps them (no jump cut) and saves all but a quarter of their length', () => {
  const p = project(), t = { min: 0, pad: 0, speed: 4 };
  const ops = acceptOps(p.suggestions, t);
  expect(ops.filter((o) => o.op === 'speed_range')).toHaveLength(2);
  expect(ops.filter((o) => o.op === 'cut_range')).toHaveLength(1); // the retake is still cut
  const next = applyOps(p, ops);
  const expected = 20 - 2 - (0.4 + 2) * 0.75;
  expect(mainDuration(next)).toBeCloseTo(expected);
  expect(tunedSavings((list) => reviewSavings(p, list), p.suggestions, t)).toBeCloseTo(20 - expected);
  expect(next.suggestions).toEqual([]);
  expect(next.clips.filter((c) => c.trackId === 'V1').some((c) => c.speed === 4)).toBe(true);
});
