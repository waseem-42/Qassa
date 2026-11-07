import { expect, it } from 'vitest';
import { applyOps, captionOps, clipEnd, defaultTracks, mainClips, Project, projectDuration, type Transcript } from '../src/index.ts';

const tr: Transcript = { mediaId: 'm', model: 'fixture', language: 'ar', segments: [], words: ['واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة'].map((w, i) => ({ w, i, t0: i + .1, t1: i + .7 })) };
const ctx = { words: () => tr.words };
function fixture(duplicate = false) {
  const p = Project.parse({ name: 'qa', createdAt: '', tracks: defaultTracks(), media: [{ id: 'm', name: 'voice', role: 'source', kind: 'audio', path: 'voice.wav', duration: 6, hasAudio: true, analyzed: ['transcribe'] }], clips: [{ id: 'voice', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 6 }, ...(duplicate ? [{ id: 'repeat', trackId: 'V1', mediaId: 'm', start: 6, in: 0, out: 6 }] : [])] });
  return applyOps(p, captionOps(p, () => tr, { maxWords: 10, maxChars: 100 }), ctx);
}
const caps = (p: Project) => p.clips.filter((c) => c.words);

it('persists source-word references and removes a deleted occurrence with its captions in the same edit', () => {
  const p = fixture(true); expect(caps(p)).toHaveLength(2);
  expect(caps(Project.parse(JSON.parse(JSON.stringify(p))))[0].words).toEqual({ mediaId: 'm', from: 0, to: 5, clipId: 'voice' });
  const next = applyOps(p, [{ op: 'delete', clipId: 'voice' }], ctx);
  expect(caps(next)).toHaveLength(1); expect(caps(next)[0].words?.clipId).toBe('repeat'); expect(caps(next)[0].start).toBe(.1);
  expect(projectDuration(next)).toBe(6); expect(caps(p)).toHaveLength(2);
  expect(caps(applyOps(next, [{ op: 'delete', clipId: 'repeat' }], ctx))).toHaveLength(0);
});

it('shrinks and splits caption text around cut source words, following source pieces and speed', () => {
  const next = applyOps(fixture(), [{ op: 'cut_range', mediaId: 'm', t0: 1, t1: 3 }], ctx);
  expect(caps(next).map((c) => c.text)).toEqual(['واحد', 'أربعة خمسة ستة']);
  expect(caps(next).map((c) => [c.words!.from, c.words!.to])).toEqual([[0, 0], [3, 5]]);
  expect(caps(next)[1].start).toBe(1.1);
  const fast = applyOps(next, [{ op: 'speed_range', mediaId: 'm', t0: 3, t1: 6, speed: 2 }], ctx);
  expect(caps(fast)[1].start).toBe(1.05); expect(Math.max(...caps(fast).map(clipEnd))).toBeLessThanOrEqual(projectDuration(fast));
});

it('ripple range deletion handles linked captions once and keeps manual text independent', () => {
  const p = applyOps(fixture(), [{ op: 'add_text', text: 'عنوان يدوي', trackId: 'T1', start: 0, duration: 1 }]);
  const next = applyOps(p, [{ op: 'delete_range', start: 1, end: 3 }], ctx);
  expect(caps(next).map((c) => c.text)).toEqual(['واحد', 'أربعة خمسة ستة']);
  expect(next.clips.some((c) => c.text === 'عنوان يدوي')).toBe(true); expect(projectDuration(next)).toBe(4);
});

it('follows free-track speech and preserves a user caption wording when only timing changes', () => {
  let p = fixture(); const voice = mainClips(p)[0];
  p = applyOps(p, [{ op: 'move', clipId: voice.id, trackId: 'A2', start: 2 }], ctx);
  expect(caps(p)[0].start).toBe(2.1);
  p = applyOps(p, [{ op: 'update_clip', clipId: caps(p)[0].id, patch: { text: 'صياغة يدوية' } }, { op: 'move', clipId: voice.id, start: 4 }], ctx);
  expect(caps(p)[0]).toMatchObject({ text: 'صياغة يدوية', start: 4.1 });
  expect(caps(applyOps(p, [{ op: 'delete', clipId: voice.id }], ctx))).toHaveLength(0);
});

it('keeps word ownership across multiple splits, trimming and merging restored source pieces', () => {
  const p = applyOps(fixture(), [{ op: 'split', clipId: 'voice', at: 3 }], ctx);
  expect(caps(p).map((c) => c.text)).toEqual(['واحد اثنان ثلاثة', 'أربعة خمسة ستة']);
  const tail = mainClips(p)[1];
  const cut = applyOps(p, [{ op: 'trim', clipId: tail.id, in: 4 }], ctx);
  expect(caps(cut)[1].text).toBe('خمسة ستة');
  const restored = applyOps(cut, [{ op: 'restore_range', mediaId: 'm', t0: 3, t1: 4 }], ctx);
  expect(caps(restored).map((c) => c.text)).toEqual(['واحد اثنان ثلاثة', 'خمسة ستة']);
  expect(caps(restored).every((c) => restored.clips.some((s) => s.id === c.words?.clipId))).toBe(true);
});

it('keep_only retains captions from every source piece without duplicating repeated words', () => {
  const split = applyOps(fixture(), [{ op: 'split', clipId: 'voice', at: 3 }], ctx);
  const kept = applyOps(split, [{ op: 'keep_only', mediaId: 'm', ranges: [[0, 1], [4, 6]] }], ctx);
  expect(caps(kept).map((c) => c.text)).toEqual(['واحد', 'خمسة ستة']);
  const repeated = applyOps(fixture(true), [{ op: 'keep_only', mediaId: 'm', ranges: [[0, 6]] }], ctx);
  expect(caps(repeated)).toHaveLength(1);
});
