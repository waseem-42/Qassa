import { expect, it } from 'vitest';
import { applyOps, defaultTracks, fillerCutOps, findFillers, mainDuration, Project, type Word } from '../src/index.ts';

const w = (list: string[]): Word[] => list.map((x, i) => ({ i, w: x, t0: i, t1: i + 0.8 }));

it('picks hesitation sounds, offers sometimes-fillers unpicked, and leaves real words alone', () => {
  const words = w(['اممم،', 'طيب', 'أم', 'مم', 'آآ', 'يعني', 'إيه', 'Umm,', 'uh', 'ممممم', 'أهلًا', 'ام', 'وين', 'آه']);
  const groups = Object.fromEntries(findFillers(words).map((g) => [g.key, g]));
  expect(groups.mm.words).toEqual([0, 3, 7, 9]);
  expect(groups.mm.picked).toBe(true);
  expect(groups.aa.words).toEqual([4, 8]);
  expect(groups.yani).toMatchObject({ words: [5], picked: false });
  expect(groups.ah).toMatchObject({ words: [6, 13], picked: false });
  // «أم» (or), «ام», «طيب», «أهلًا», «وين» are speech
  for (const i of [1, 2, 10, 11, 12]) expect(Object.values(groups).some((g) => g.words.includes(i))).toBe(false);
});

it('skips words already cut and merges neighbours into one cut', () => {
  const words = w(['اممم', 'آآ', 'كلام', 'اممم']);
  expect(findFillers(words, ['cut', 'keep', 'keep', 'keep']).flatMap((g) => g.words).sort()).toEqual([1, 3]);
  expect(fillerCutOps('m', [3, 0, 1])).toEqual([{ op: 'cut_words', mediaId: 'm', from: 3, to: 3 }, { op: 'cut_words', mediaId: 'm', from: 0, to: 1 }]);
  expect(fillerCutOps('m', [])).toEqual([]);
});

it('cutting the fillers is one batch that shortens the edit', () => {
  const words = w(['هلا', 'اممم', 'بكم', 'آآ', 'اليوم']);
  const p = Project.parse({
    name: 'f', createdAt: '', tracks: defaultTracks(),
    media: [{ id: 'm', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 5, hasAudio: true }],
    clips: [{ id: 'v', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 5 }],
  });
  const ops = fillerCutOps('m', findFillers(words).filter((g) => g.picked).flatMap((g) => g.words));
  const next = applyOps(p, ops, { words: () => words });
  expect(mainDuration(next)).toBeLessThan(4);
  expect(mainDuration(next)).toBeGreaterThan(2.5);
});
