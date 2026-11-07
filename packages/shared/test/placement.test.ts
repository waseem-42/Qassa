import { expect, it } from 'vitest';
import { applyOps, clipEnd, defaultTracks, freeMoveOps, freeTrackFor, mediaPlacementOps, Project, trackOverlaps } from '../src/index.ts';

const fixture = () => Project.parse({ name: 'placement', createdAt: '', tracks: [...defaultTracks(), { id: 'V3', name: 'طبقة', kind: 'overlay' }], media: [{ id: 'v', name: 'video', path: 'v.mp4', kind: 'video', role: 'broll', duration: 5, hasAudio: true }], clips: [{ id: 'a', trackId: 'V2', mediaId: 'v', start: 5, in: 0, out: 5 }, { id: 'b', trackId: 'V3', mediaId: 'v', start: 5, in: 0, out: 5 }, { id: 'c', trackId: 'V2', mediaId: 'v', start: 15, in: 0, out: 5 }] });

it('uses a free preferred span, treats touching edges as free, and inserts above a busy preferred track', () => {
  const p = fixture(), m = p.media[0];
  expect(freeTrackFor(p, m, 10, 15, 'V2').track.id).toBe('V2');
  expect(freeTrackFor(p, m, 5, 10, 'V2', ['a']).track.id).toBe('V2');
  const plan = freeTrackFor(p, m, 5, 10, 'V2');
  const next = applyOps(p, plan.ops);
  expect(next.tracks.indexOf(next.tracks.find((t) => t.id === plan.track.id)!)).toBe(next.tracks.findIndex((t) => t.id === 'V2') - 1);
  expect(plan.track.kind).toBe('overlay');
  expect(freeTrackFor(p, m, 15, 20, 'V2').track.id).toBe('V3');
});

it('media drops at occupied destinations and explicit between-row drops never hide clips', () => {
  const p = fixture();
  const next = applyOps(p, mediaPlacementOps(p, p.media[0], { trackId: 'V2', at: 5 }));
  expect(next.clips.at(-1)!.trackId).not.toBe('V2');
  for (const t of next.tracks) expect(trackOverlaps(next, t.id)).toEqual([]);
  const inserted = applyOps(p, mediaPlacementOps(p, p.media[0], { newTrack: true, trackIndex: 2, at: 1 }));
  expect(inserted.tracks[2].id).toBe(inserted.clips.at(-1)!.trackId);
});

it('moves groups with one shared delta, reserves newly made layers, and clamps the whole group at zero', () => {
  const p = fixture(), clips = [p.clips[0], p.clips[2]];
  const next = applyOps(p, freeMoveOps(p, clips, 0));
  expect(next.clips.find((c) => c.id === 'a')!.trackId).toBe('V2');
  const moved = applyOps(p, freeMoveOps(p, clips, -99));
  expect(clips.map((c) => moved.clips.find((x) => x.id === c.id)!.start)).toEqual([0, 10]);
  for (const t of moved.tracks) expect(trackOverlaps(moved, t.id)).toEqual([]);
  expect(moved.clips.map(clipEnd).every(Number.isFinite)).toBe(true);
});

it('reports legacy overlaps without rejecting intentional add/move ops, including contained spans', () => {
  const p = fixture();
  const next = applyOps(p, [{ op: 'add_clip', clip: { id: 'inside', mediaId: 'v', trackId: 'V2', start: 6, in: 0, out: 1 } }]);
  expect(trackOverlaps(next, 'V2')).toEqual([{ start: 6, end: 7 }]);
});

it('preserves voice routing and text compatibility when finding another layer', () => {
  const p = fixture();
  p.tracks.push({ ...p.tracks.find((t) => t.kind === 'audio')!, id: 'voice', name: 'كلام', audio: 'voice' });
  p.clips.push({ ...p.clips[0], id: 'voice1', trackId: 'voice' });
  const plan = freeTrackFor(p, p.clips.at(-1)!, 5, 10, 'voice');
  expect(plan.track.id).not.toBe('A2'); expect(plan.track.audio).toBe('voice');
  const text = { ...p.clips[0], mediaId: undefined, text: 'عنوان', trackId: 'T1' };
  expect(freeTrackFor(p, text, 0, 2, 'T1').track.id).toBe('T1');
});
