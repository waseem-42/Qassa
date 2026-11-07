import { expect, it } from 'vitest';
import { applyOps, defaultTracks, mainClips, Project, sourceToTimeline, timelineToSource } from '../src/index.ts';

const fixture = () => Project.parse({
  name: 'gaps', createdAt: '', tracks: defaultTracks(),
  media: [{ id: 'v', path: 'source/v.mp4', name: 'v', kind: 'video', role: 'source', duration: 30, hasAudio: true }],
  clips: [
    { id: 'a', trackId: 'V1', mediaId: 'v', in: 0, out: 4, start: 0 },
    { id: 'b', trackId: 'V1', mediaId: 'v', in: 10, out: 13, start: 4 },
    { id: 'c', trackId: 'V1', mediaId: 'v', in: 20, out: 22, start: 7 },
    { id: 't', trackId: 'T1', text: 'over b', in: 0, out: 1, start: 5 },
  ],
});
const shape = (p: Project) => mainClips(p).map((c) => (c.gap ? `gap ${c.start}-${c.start + c.out}` : `${c.id} ${c.start}`));

it('move_main leaves a gap before the clip and takes it from the gap after; the clips after stay put', () => {
  let p = applyOps(fixture(), [{ op: 'move_main', clipId: 'b', start: 6 }]);
  expect(shape(p)).toEqual(['a 0', 'gap 4-6', 'b 6', 'c 9']); // no gap after b: c is pushed
  p = applyOps(p, [{ op: 'move_main', clipId: 'b', start: 5 }]);
  expect(shape(p)).toEqual(['a 0', 'gap 4-5', 'b 5', 'gap 8-9', 'c 9']); // moving back leaves c where it was
  p = applyOps(p, [{ op: 'move_main', clipId: 'b', start: 5.5 }]);
  expect(shape(p)).toEqual(['a 0', 'gap 4-5.5', 'b 5.5', 'gap 8.5-9', 'c 9']);
  // never into the clip before
  p = applyOps(p, [{ op: 'move_main', clipId: 'b', start: 1 }]);
  expect(shape(p)).toEqual(['a 0', 'b 4', 'gap 7-9', 'c 9']);
  // the text over b followed it
  expect(p.clips.find((c) => c.id === 't')!.start).toBe(5);
  expect(timelineToSource(p, 7.5)?.clip.gap).toBe(true);
  expect(sourceToTimeline(p, 'v', 21)).toBe(10);
});

it('delete with lift leaves a gap; deleting a gap closes it; gaps merge and never trail', () => {
  let p = applyOps(fixture(), [{ op: 'delete', clipId: 'b', lift: true }]);
  expect(shape(p)).toEqual(['a 0', 'gap 4-7', 'c 7']);
  p = applyOps(p, [{ op: 'delete', clipId: 'a', lift: true }]);
  expect(shape(p)).toEqual(['gap 0-7', 'c 7']); // neighbouring gaps merge
  p = applyOps(p, [{ op: 'delete', clipId: 'c', lift: true }]);
  expect(mainClips(p)).toEqual([]); // a gap at the end is dropped
  const q = applyOps(fixture(), [{ op: 'delete', clipId: 'b', lift: true }]);
  const g = mainClips(q).find((c) => c.gap)!;
  expect(shape(applyOps(q, [{ op: 'delete', clipId: g.id }]))).toEqual(['a 0', 'c 4']);
  expect(() => applyOps(q, [{ op: 'set_transition', clipIds: [g.id], kind: 'crossfade' }])).toThrow('gap');
  expect(() => applyOps(q, [{ op: 'move_main', clipId: g.id, start: 1 }])).toThrow('gap');
});
