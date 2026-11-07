import { expect, it } from 'vitest';
import { applyOps, defaultTracks, markedRange, Project } from '../src/index.ts';

const base = () => Project.parse({ name: 'marks', createdAt: '', tracks: defaultTracks(), media: [{ id: 'm', name: 'm', kind: 'video', role: 'source', path: 'm.mp4', duration: 100, hasAudio: true }], clips: [{ id: 'a', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 20, speed: 2 }, { id: 'b', trackId: 'V1', mediaId: 'm', start: 10, in: 20, out: 30 }] });

it('swaps reversed marks, persists through schema round trips and keeps absolute time across V1 edits', () => {
  let p = applyOps(base(), [{ op: 'set_marks', in: 12 }, { op: 'set_marks', out: 5 }]);
  expect(markedRange(Project.parse(JSON.parse(JSON.stringify(p))))).toEqual([5, 12]);
  p = applyOps(p, [{ op: 'cut_range', mediaId: 'm', t0: 0, t1: 2 }]);
  expect(markedRange(p)).toEqual([5, 12]);
  p = applyOps(p, [{ op: 'set_marks', in: null }]); expect(p.settings.marks).toEqual({ out: 12 });
  p = applyOps(p, [{ op: 'set_marks', out: null }]); expect(p.settings.marks).toEqual({});
});

it('ripple-deletes one timeline span through source speeds and every free track without double anchoring', () => {
  const p = Project.parse({ ...base(), settings: { marks: { in: 5, out: 12 } }, clips: [...base().clips, { id: 'sound', mediaId: 'm', trackId: 'A2', start: 3, in: 50, out: 62, anim: { volume: [{ t: 0, v: 0 }, { t: 12, v: 1 }] } }, { id: 'title', trackId: 'T1', text: 'عنوان', start: 4, in: 0, out: 10 }, { id: 'inside', mediaId: 'm', trackId: 'V2', start: 6, in: 0, out: 2 }, { id: 'after', mediaId: 'm', trackId: 'V2', start: 14, in: 5, out: 6 }], notes: [{ id: 'n', text: 'ملاحظة', at: 4, end: 14 }] });
  const next = applyOps(p, [{ op: 'delete_range', start: 5, end: 12 }]);
  expect(next.clips.filter((c) => c.trackId === 'V1').map((c) => [c.start, c.in, c.out, c.speed])).toEqual([[0, 0, 10, 2], [5, 22, 30, 1]]);
  expect(next.clips.filter((c) => c.trackId === 'A2').map((c) => [c.start, c.in, c.out])).toEqual([[3, 50, 52], [5, 59, 62]]);
  expect(next.clips.filter((c) => c.trackId === 'A2')[1].anim?.volume?.[0].t).toBe(-9);
  expect(next.clips.filter((c) => c.trackId === 'T1').map((c) => [c.start, c.in, c.out])).toEqual([[4, 0, 1], [5, 0, 2]]);
  expect(next.clips.some((c) => c.id === 'inside')).toBe(false);
  expect(next.clips.find((c) => c.id === 'after')?.start).toBe(7);
  expect(next.notes[0]).toMatchObject({ at: 4, end: 7 });
  expect(markedRange(next)).toEqual([5, 12]); expect(p.clips).toHaveLength(6);
});
