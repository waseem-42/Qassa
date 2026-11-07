import { expect, it } from 'vitest';
import { applyOps, defaultTracks, Op, Project } from '../src/index.ts';

const fixture = () => Project.parse({
  name: 'remove', createdAt: '', tracks: defaultTracks(),
  media: [
    { id: 'a', path: 'source/a.mp4', name: 'a', kind: 'video', role: 'source', duration: 10, hasAudio: true },
    { id: 'b', path: 'source/b.mp4', name: 'b', kind: 'video', role: 'source', duration: 6, hasAudio: true },
    { id: 'i', path: 'source/i.png', name: 'i', kind: 'image', role: 'broll', duration: 5 },
  ],
  clips: [
    { id: 'c1', trackId: 'V1', mediaId: 'a', in: 0, out: 4, start: 0 },
    { id: 'c2', trackId: 'V1', mediaId: 'b', in: 0, out: 6, start: 4 },
    { id: 'c3', trackId: 'V1', mediaId: 'a', in: 4, out: 10, start: 10 },
    { id: 'o1', trackId: 'V2', mediaId: 'i', in: 0, out: 2, start: 1 },
  ],
  suggestions: [{ id: 's', mediaId: 'b', t0: 1, t1: 2, reason: 'silence' }],
});

it('removes media with its clips on every track and closes V1 up', () => {
  const p = applyOps(fixture(), [{ op: 'remove_media', mediaIds: ['b', 'i'] }]);
  expect(p.media.map((m) => m.id)).toEqual(['a']);
  expect(p.clips.map((c) => [c.id, c.start])).toEqual([['c1', 0], ['c3', 4]]);
  expect(p.suggestions).toEqual([]);
});

it('removes media that is not on the timeline and rejects unknown ids', () => {
  const p = applyOps(fixture(), [{ op: 'remove_media', mediaIds: ['i'] }]);
  expect(p.media).toHaveLength(2);
  expect(p.clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  expect(() => applyOps(fixture(), [{ op: 'remove_media', mediaIds: ['x'] }])).toThrow('media x not found');
  expect(Op.safeParse({ op: 'remove_media', mediaIds: [] }).success).toBe(false);
});
