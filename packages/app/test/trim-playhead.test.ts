import { expect, it } from 'vitest';
import { applyOps, defaultTracks, mainDuration, Project } from '@edit/shared';
import { trimToPlayhead } from '../src/lib/trim-playhead.ts';

const media = [{ id: 'm', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 20 }];
const project = () => Project.parse({
  name: 'trim', createdAt: '', tracks: defaultTracks(), media,
  clips: [
    { id: 'a', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 4 },
    { id: 'b', trackId: 'V1', mediaId: 'm', start: 4, in: 10, out: 16 },
    { id: 't', trackId: 'T1', text: 'عنوان', start: 5, in: 0, out: 3 },
  ],
});

it('Q on the main track drops everything before the playhead and ripples the rest', () => {
  const p = project();
  const plan = trimToPlayhead(p, [], 6, 'start')!;
  const next = applyOps(p, plan.ops);
  const b = next.clips.find((c) => c.id === 'b')!;
  expect(b.in).toBe(12);
  expect(b.start).toBe(4);
  expect(mainDuration(next)).toBe(8);
  expect(plan.seek).toBe(4);
});

it('W keeps the start and drops the rest of the clip', () => {
  const p = project();
  const next = applyOps(p, trimToPlayhead(p, [], 2.5, 'end')!.ops);
  expect(next.clips.find((c) => c.id === 'a')!.out).toBe(2.5);
  expect(mainDuration(next)).toBe(8.5);
});

it('a selected free clip under the playhead is trimmed in place; nothing under the playhead is a no-op', () => {
  const p = project();
  const plan = trimToPlayhead(p, ['t'], 6, 'start')!;
  const t = applyOps(p, plan.ops).clips.find((c) => c.id === 't')!;
  expect([t.start, t.out - t.in]).toEqual([6, 2]);
  expect(plan.seek).toBeUndefined();
  expect(trimToPlayhead(p, [], 30, 'end')).toBeNull();
  // at an edge there is nothing to trim
  expect(trimToPlayhead(p, [], 4, 'start')).toBeNull();
});

it('respects clip speed and locked tracks', () => {
  let p = project();
  p = applyOps(p, [{ op: 'update_clip', clipId: 'a', patch: { speed: 2 } }]);
  const plan = trimToPlayhead(p, [], 1, 'end')!;
  expect(applyOps(p, plan.ops).clips.find((c) => c.id === 'a')!.out).toBe(2);
  const locked = applyOps(project(), [{ op: 'set_track', trackId: 'T1', patch: { locked: true } }]);
  const free = trimToPlayhead(locked, ['t'], 6, 'start')!;
  expect(free.ops.every((o) => 'clipId' in o && o.clipId !== 't')).toBe(true);
});
