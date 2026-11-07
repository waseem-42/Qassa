import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, mainClips, Media, Project } from '@edit/shared';
import { sourceRangeOp } from '../src/lib/source-range.ts';

const media = Media.parse({ id: 'm', name: 'source', path: 'source/test.mp4', kind: 'video', role: 'source', duration: 30 });
describe('source range insertion', () => {
  it('appends source seconds to magnetic V1 without replacing existing edits', () => {
    const project = Project.parse({ name: 'test', createdAt: '2026-10-29', tracks: defaultTracks(), media: [media], clips: [{ id: 'old', trackId: 'V1', mediaId: 'm', in: 5, out: 10, start: 0 }] });
    const next = applyOps(project, [sourceRangeOp(media, 12, 17, 'V1', 200)]);
    expect(mainClips(next).map((c) => [c.in, c.out, c.start])).toEqual([[5, 10, 0], [12, 17, 5]]);
    expect(project.clips).toHaveLength(1);
  });
  it('places b-roll at timeline time while preserving source bounds', () => {
    expect(sourceRangeOp(media, 12, 17, 'V2', 3)).toMatchObject({ clip: { in: 12, out: 17, start: 3, trackId: 'V2' } });
  });
  it.each([[NaN, 10], [0, Infinity], [-1, 10], [5, 5], [10, 5], [0, 31], [0, 0.001]])('rejects invalid source interval %s to %s', (from, to) => {
    expect(() => sourceRangeOp(media, from, to, 'V1', 0)).toThrow();
  });
});
