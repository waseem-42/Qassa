import { expect, it } from 'vitest';
import { activeWord, applyOps, captionWordStarts, defaultTracks, expandHighlights, highlightPieces, Project, textLayerHtml, type Word } from '../src/index.ts';

const words: Word[] = [
  { i: 0, w: 'أهلًا', t0: 1.0, t1: 1.4 },
  { i: 1, w: 'بكم', t0: 1.5, t1: 1.9 },
  { i: 2, w: 'جميعًا', t0: 2.0, t1: 2.6 },
  { i: 3, w: 'اليوم', t0: 6.0, t1: 6.5 },
] as Word[];
const transcript = (id: string) => (id === 'm' ? words : undefined);
const project = () => Project.parse({
  name: 'hl', createdAt: '', tracks: [...defaultTracks(), { id: 'CAP', kind: 'text', name: 'كابشن' }],
  media: [{ id: 'm', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 20, hasAudio: true }],
  clips: [
    { id: 'v', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 20 },
    { id: 'c', trackId: 'CAP', text: 'أهلًا بكم جميعًا', start: 1, in: 0, out: 1.8, words: { mediaId: 'm', from: 0, to: 2, clipId: 'v' }, textStyle: { preset: 'caption', animation: 'none', highlight: '#f2b33d' } },
  ],
});

it('finds when each caption word plays, and follows cuts', () => {
  const p = project(), c = p.clips[1];
  expect(captionWordStarts(p, c, transcript)).toEqual([1, 1.5, 2]);
  // half a second cut before the caption: everything plays earlier
  const cut = applyOps(p, [{ op: 'cut_range', mediaId: 'm', t0: 0.2, t1: 0.7 }], { words: transcript });
  const moved = cut.clips.find((x) => x.text)!;
  expect(captionWordStarts(cut, moved, transcript)!.map((t) => Math.round(t * 1000) / 1000)).toEqual([0.5, 1, 1.5]);
  // an edited text no longer matches its words: no highlight rather than a wrong one
  expect(captionWordStarts(p, { ...c, text: 'نص آخر تمامًا هنا' }, transcript)).toBeNull();
  expect(captionWordStarts(p, c, () => undefined)).toBeNull();
});

it('lights the current word and splits the caption into gapless pieces', () => {
  const p = project(), c = p.clips[1], starts = captionWordStarts(p, c, transcript)!;
  expect([0.9, 1.2, 1.5, 1.99, 2.5].map((t) => activeWord(starts, t))).toEqual([0, 0, 1, 1, 2]);
  expect(highlightPieces(c, starts)).toEqual([{ start: 1, end: 1.5, active: 0 }, { start: 1.5, end: 2, active: 1 }, { start: 2, end: 2.8, active: 2 }]);
  // a word shorter than a frame merges into the one before it
  expect(highlightPieces(c, [1, 1.5, 1.51], 1 / 30)).toEqual([{ start: 1, end: 1.51, active: 0 }, { start: 1.51, end: 2.8, active: 2 }]);
});

it('the export sees one still per word; plain captions and other clips stay as they are', () => {
  const p = project();
  const { project: out, active } = expandHighlights(p, transcript);
  const pieces = out.clips.filter((c) => c.trackId === 'CAP');
  expect(pieces.map((c) => [c.id, c.start, c.out])).toEqual([['c~0', 1, 0.5], ['c~1', 1.5, 0.5], ['c~2', 2, 0.8]]);
  expect([...active.values()]).toEqual([0, 1, 2]);
  expect(pieces.every((c) => c.textStyle?.animation === 'none')).toBe(true);
  expect(out.clips.find((c) => c.id === 'v')).toBe(p.clips[0]);
  const plain = applyOps(p, [{ op: 'update_clip', clipId: 'c', patch: { textStyle: { highlight: null } } }]);
  expect(plain.clips[1].textStyle?.highlight).toBeUndefined();
  expect(expandHighlights(plain, transcript).project).toBe(plain);
});

it('colours exactly the spoken word in the shared markup', () => {
  const c = project().clips[1];
  const html = textLayerHtml(c, 1080, undefined, 1);
  expect(html).toContain('<span style="color:#f2b33d">بكم</span>');
  expect(html.match(/<span/g)).toHaveLength(1);
  expect(textLayerHtml(c, 1080)).not.toContain('<span');
  expect(textLayerHtml({ ...c, text: 'سطر\nثاني' }, 1080, undefined, 1)).toContain('سطر\n<span style="color:#f2b33d">ثاني</span>');
});
