import { expect, it } from 'vitest';
import { applyOps, captionOps, clipEnd, defaultTracks, mainClips, newOverlapWarnings, Project, type Transcript, type Word } from '../src/index.ts';

const words: Word[] = [
  { i: 0, w: 'قبل', t0: .1, t1: .5 },
  { i: 1, w: 'احذف', t0: 2.2, t1: 2.5 },
  { i: 2, w: 'أطفالنا', t0: 2.5, t1: 3 },
  { i: 3, w: 'بعد', t0: 3, t1: 3.4 },
  { i: 4, w: 'النهاية', t0: 3.5, t1: 4 },
];
function fixture() {
  return Project.parse({ name: 'task15', createdAt: '', tracks: defaultTracks(), media: [{ id: 'm', path: 'voice.mp4', name: 'كلام', kind: 'video', role: 'source', duration: 10, hasAudio: true }], clips: [{ id: 'main', trackId: 'V1', mediaId: 'm', in: 0, out: 10, start: 0 }] });
}

it('cuts adjacent words completely and removes a long preceding pause with a reported breath', () => {
  const messages: string[] = [];
  const p = applyOps(fixture(), [{ op: 'cut_words', mediaId: 'm', from: 1, to: 2 }], { words: () => words, report: (s) => messages.push(s) });
  const [a, b] = mainClips(p);
  expect(a.out).toBeCloseTo(.62, 3); expect(b.in).toBe(3);
  expect((a.out - words[0].t1) + words[3].t0 - b.in).toBeCloseTo(.12, 3);
  for (const c of mainClips(p)) for (const w of words.slice(1, 3)) expect(Math.min(c.out, w.t1) - Math.max(c.in, w.t0)).toBeLessThanOrEqual(0);
  expect(messages).toHaveLength(1); expect(messages[0]).toMatch(/0.12s/);
  expect(fixture().clips).toHaveLength(1);
});

it('keeps a long speechless stretch across the cut (it may be on-screen work) and says so', () => {
  const messages: string[] = [];
  const demo = words.map((w, i) => (i === 0 ? { ...w, t0: .1, t1: .5 } : { ...w, t0: w.t0 + 5, t1: w.t1 + 5 }));
  const p = applyOps(fixture(), [{ op: 'cut_words', mediaId: 'm', from: 1, to: 2 }], { words: () => demo, report: (s) => messages.push(s) });
  const [a, b] = mainClips(p);
  expect(a.out).toBeGreaterThan(7); expect(b.in).toBeCloseTo(8, 3);
  expect(messages).toHaveLength(1); expect(messages[0]).toMatch(/kept/);
});

it('clamps padding at both edges, handles speed and existing cuts, and rejects reversed word ranges', () => {
  const adjacent = words.map((w, i) => ({ ...w, t0: i, t1: i + 1 }));
  const p = applyOps(fixture(), [{ op: 'cut_words', mediaId: 'm', from: 1, to: 2, pad: .5 }], { words: () => adjacent });
  expect(mainClips(p).map((c) => [c.in, c.out])).toEqual([[0, 1], [3, 10]]);
  const fast = applyOps(fixture(), [{ op: 'update_clip', clipId: 'main', patch: { speed: 2 } }, { op: 'cut_words', mediaId: 'm', from: 1, to: 2 }], { words: () => words });
  expect((mainClips(fast)[0].out - .5) / 2).toBeCloseTo(.12, 3);
  const cut = applyOps(fixture(), [{ op: 'cut_words', mediaId: 'm', from: 1, to: 1 }, { op: 'cut_words', mediaId: 'm', from: 2, to: 2 }], { words: () => words });
  expect(mainClips(cut).at(-1)!.in).toBe(3);
  expect(() => applyOps(fixture(), [{ op: 'cut_words', mediaId: 'm', from: 2, to: 1 }], { words: () => words })).toThrow('reversed');
  const end = applyOps(fixture(), [{ op: 'cut_words', mediaId: 'm', from: 0, to: 4 }], { words: () => words });
  expect(mainClips(end).at(-1)!.in).toBeGreaterThanOrEqual(4);
});

it('removes speechless islands left by accepted silence cuts before cutting adjacent words', () => {
  const notices: string[] = [];
  const p = applyOps(fixture(), [{ op: 'cut_range', mediaId: 'm', t0: .62, t1: 2.1 }, { op: 'cut_words', mediaId: 'm', from: 1, to: 2 }], { words: () => words, report: (s) => notices.push(s) });
  expect(mainClips(p).map((c) => [c.in, c.out])).toEqual([[0, .62], [3, 10]]);
  expect(notices).toHaveLength(1); expect(notices[0]).toMatch(/to 0.12s/);
});

it('safe placement reserves earlier batch clips, reuses tracks, preserves routing and leaves defaults permissive', () => {
  const before = fixture();
  const p = applyOps(before, [
    { op: 'add_clip', clip: { id: 'a', trackId: 'overlay', mediaId: 'm', in: 0, out: 4, start: 1 } },
    { op: 'add_clip', free: true, clip: { id: 'b', trackId: 'V2', mediaId: 'm', in: 0, out: 4, start: 2 } },
    { op: 'add_clip', free: true, clip: { id: 'c', trackId: 'V2', mediaId: 'm', in: 0, out: 2, start: 6 } },
  ]);
  expect(p.clips.find((c) => c.id === 'a')!.trackId).toBe('V2');
  expect(p.clips.find((c) => c.id === 'b')!.trackId).not.toBe('V2');
  expect(p.clips.find((c) => c.id === 'c')!.trackId).toBe('V2');
  expect(newOverlapWarnings(before, p)).toEqual([]);
  const overlap = applyOps(p, [{ op: 'move', clipId: 'c', start: 2 }]);
  expect(newOverlapWarnings(p, overlap)).toHaveLength(1); expect(newOverlapWarnings(p, overlap)[0]).toMatch(/كلام.*free:true/);
  expect(newOverlapWarnings(overlap, applyOps(overlap, [{ op: 'set_marks', in: 1 }]))).toEqual([]);
  const safe = applyOps(overlap, [{ op: 'move', clipId: 'c', start: 2, trackId: 'overlay', free: true }]);
  expect(safe.clips.find((c) => c.id === 'c')!.trackId).not.toBe('V2');
  expect(newOverlapWarnings(overlap, safe)).toEqual([]);
  const voice = applyOps(before, [{ op: 'set_track', trackId: 'A2', patch: { audio: 'voice' } }, { op: 'add_clip', clip: { id: 'sound', trackId: 'A2', mediaId: 'm', in: 0, out: 4, start: 0 } }, { op: 'add_clip', free: true, clip: { id: 'voice', trackId: 'A2', mediaId: 'm', in: 0, out: 4, start: 0 } }]);
  expect(voice.tracks.find((t) => t.id === voice.clips.find((c) => c.id === 'voice')!.trackId)!.audio).toBe('voice');
  expect(() => applyOps(before, [{ op: 'move', clipId: 'main', free: true }])).toThrow('free placement');
  expect(before.tracks).toHaveLength(defaultTracks().length);
  const kinds = applyOps(before, [
    { op: 'add_clip', clip: { id: 'text-kind', trackId: 'text', text: 'عنوان', in: 0, out: 2, start: 0 } },
    { op: 'add_clip', clip: { id: 'audio-kind', trackId: 'audio', mediaId: 'm', in: 0, out: 2, start: 0 } },
  ]);
  for (const [id, kind] of [['text-kind', 'text'], ['audio-kind', 'audio']]) expect(kinds.tracks.find(t => t.id === kinds.clips.find(c => c.id === id)!.trackId)!.kind).toBe(kind);
});

it('balances caption orphans and retains exact links without merging across source occurrences', () => {
  const tr: Transcript = { mediaId: 'm', language: 'ar', model: 'fixture', segments: [], words: Array.from({ length: 8 }, (_, i) => ({ i, w: 'كلمة', t0: i * .3, t1: i * .3 + .2 })) };
  const captions = (p: Project, maxChars = 100) => applyOps(p, captionOps(p, () => tr, { maxWords: 7, maxChars }), { words: () => tr.words }).clips.filter((c) => c.words);
  expect(captions(fixture())).toHaveLength(1);
  expect(captions(fixture())[0].words).toEqual({ mediaId: 'm', from: 0, to: 7, clipId: 'main' });
  const balanced = captions(fixture(), 34);
  expect(balanced.every((c) => c.words!.to > c.words!.from)).toBe(true);
  expect(balanced.flatMap((c) => Array.from({ length: c.words!.to - c.words!.from + 1 }, (_, i) => c.words!.from + i))).toEqual(tr.words.map((w) => w.i));
  const split = applyOps(fixture(), [{ op: 'split', clipId: 'main', at: .25 }]);
  const result = captions(split);
  expect(result[0].words).toMatchObject({ from: 0, to: 0, clipId: 'main' });
  expect(result[1].words!.clipId).not.toBe('main');
  expect(result.every((c) => clipEnd(c) <= clipEnd(split.clips.find((s) => s.id === c.words!.clipId)!))).toBe(true);
});

it('safe moves off V1 reserve against the re-anchored positions of other layers', () => {
  const before = applyOps(fixture(), [
    { op: 'add_clip', clip: { id: 'tail', trackId: 'V1', mediaId: 'm', in: 0, out: 10 } },
    { op: 'add_clip', clip: { id: 'anchored', trackId: 'V2', mediaId: 'm', in: 0, out: 2, start: 12 } },
  ]);
  const after = applyOps(before, [{ op: 'move', clipId: 'main', trackId: 'V2', start: 0, free: true }]);
  expect(after.clips.find(c => c.id === 'anchored')!.start).toBe(2);
  expect(after.clips.find(c => c.id === 'main')!.trackId).not.toBe(after.clips.find(c => c.id === 'anchored')!.trackId);
  expect(newOverlapWarnings(before, after)).toEqual([]);
});

it('caption balancing preserves a sentence boundary when an orphan can join its other neighbour', () => {
  const tr: Transcript = { mediaId: 'm', language: 'ar', model: 'fixture', segments: [], words: Array.from({ length: 7 }, (_, i) => ({ i, w: i === 2 ? 'كلمة.' : 'كلمة', t0: i * .3 + (i > 3 ? .6 : 0), t1: i * .3 + .2 + (i > 3 ? .6 : 0) })) };
  const ops = captionOps(fixture(), () => tr, { maxWords: 7, maxChars: 100 });
  expect(ops.filter(o => o.op === 'add_text').map(o => o.words && [o.words.from, o.words.to])).toEqual([[0, 2], [3, 6]]);
});
