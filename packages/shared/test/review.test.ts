import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, mainDuration, Project, reviewSavings, reviewTime, type Suggestion } from '../src/index.ts';

const proposal = (id: string, t0: number, t1: number): Suggestion => ({ id, mediaId: 'm', t0, t1, reason: 'silence', author: 'analysis' });
const makeProject = () => Project.parse({ name: 'review', createdAt: '2026-01-01', tracks: defaultTracks(),
  clips: [{ id: 'a', mediaId: 'm', trackId: 'V1', in: 10, out: 30, start: 0, speed: 2 },
    { id: 'b', mediaId: 'm', trackId: 'V1', in: 10, out: 20, start: 10, speed: 1 }],
});

describe('suggestion review', () => {
  it('unions overlapping ranges and accounts for speed and repeated source footage', () => {
    expect(reviewSavings(makeProject(), [proposal('a', 5, 15), proposal('b', 12, 18)])).toBe(12);
  });
  it('ignores removed footage, unrelated media and empty ranges', () => {
    expect(reviewSavings(makeProject(), [proposal('a', 0, 5), proposal('b', 20, 20), { ...proposal('c', 10, 30), mediaId: 'other' }])).toBe(0);
  });
  it('matches the actual resulting duration when proposals are applied', () => {
    const p = makeProject();
    p.suggestions = [proposal('a', 8, 14), proposal('b', 12, 22), proposal('c', 28, 40)];
    const after = applyOps(p, [{ op: 'resolve_suggestions', ids: 'all', accept: true }]);
    expect(reviewSavings(p, p.suggestions)).toBeCloseTo(mainDuration(p) - mainDuration(after));
  });
  it('seeks to surviving content when the beginning of a proposal was already removed', () => {
    expect(reviewTime(makeProject(), proposal('a', 5, 15))).toBe(0);
    expect(reviewTime(makeProject(), proposal('b', 22, 25))).toBe(6);
    expect(reviewTime(makeProject(), proposal('c', 0, 10))).toBeNull();
  });
});
