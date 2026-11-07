import { expect, it } from 'vitest';
import { applyOps, defaultTracks, freeTrackFor, Project } from '../src/index.ts';

const fixture = () => applyOps(Project.parse({
  name: 'lock', createdAt: '', tracks: defaultTracks(),
  media: [{ id: 'v', path: 'source/v.mp4', name: 'v', kind: 'video', role: 'source', duration: 20, hasAudio: true }],
  clips: [
    { id: 'm', trackId: 'V1', mediaId: 'v', in: 0, out: 10, start: 0 },
    { id: 'o', trackId: 'V2', mediaId: 'v', in: 0, out: 2, start: 3 },
  ],
}), [{ op: 'set_track', trackId: 'V2', patch: { locked: true } }]);

it('a locked track refuses edits to its clips and new clips, and unlocks', () => {
  const p = fixture();
  expect(p.tracks.find((t) => t.id === 'V2')!.locked).toBe(true);
  for (const op of [
    { op: 'delete', clipId: 'o' }, { op: 'move', clipId: 'o', start: 5 }, { op: 'update_clip', clipId: 'o', patch: { volume: 0 } },
    { op: 'add_clip', clip: { trackId: 'V2', mediaId: 'v', in: 0, out: 1, start: 8 } }, { op: 'remove_track', trackId: 'V2', deleteClips: true },
    { op: 'delete_range', start: 1, end: 2 }, { op: 'remove_media', mediaIds: ['v'] },
  ] as const) expect(() => applyOps(p, [op as never]), op.op).toThrow('مقفول');
  // other tracks still edit; free placement skips the locked layer
  expect(applyOps(p, [{ op: 'split', clipId: 'm', at: 4 }]).clips).toHaveLength(3);
  expect(freeTrackFor(p, p.media[0], 3, 5, 'V2').track.id).not.toBe('V2');
  const open = applyOps(p, [{ op: 'set_track', trackId: 'V2', patch: { locked: false } }, { op: 'delete', clipId: 'o' }]);
  expect(open.clips.map((c) => c.id)).toEqual(['m']);
});

it('a locked main track refuses source edits', () => {
  const p = applyOps(fixture(), [{ op: 'set_track', trackId: 'V1', patch: { locked: true } }]);
  expect(() => applyOps(p, [{ op: 'cut_range', mediaId: 'v', t0: 1, t1: 2 }])).toThrow('مقفول');
});
