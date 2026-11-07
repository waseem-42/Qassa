import { expect, it } from 'vitest';
import { applyOps, defaultTracks, Project, Track } from '../src/index.ts';

const base = () => Project.parse({ name: 'tracks', createdAt: '', tracks: defaultTracks(), media: [{ id: 'voice', name: 'voice', path: 'voice.wav', role: 'source', kind: 'audio', hasAudio: true, duration: 10 }], clips: [{ id: 'main', trackId: 'V1', mediaId: 'voice', start: 0, in: 0, out: 10 }, { id: 'caption', trackId: 'T1', text: 'مرحبا', start: 2, in: 0, out: 2 }] });

it('new project shapes differ only by starting tracks, and old audio defaults to music', () => {
  expect(defaultTracks('empty').map((t) => t.id)).toEqual(['V1']);
  expect(defaultTracks('video')).toHaveLength(4);
  expect(defaultTracks('podcast').filter((t) => t.kind === 'overlay')).toHaveLength(2);
  expect(Track.parse({ id: 'old', kind: 'audio', name: '' }).audio).toBe('music');
  expect(defaultTracks('video').find((t) => t.id === 'V2')?.name).toBe('لقطات فوقية');
  expect(Track.parse({ id: 'V2', kind: 'overlay', name: 'بي-رول' }).name).toBe('بي-رول');
});

it('adds, renames and reorders tracks without moving clips or losing audio mode', () => {
  const p = base();
  const next = applyOps(p, [{ op: 'add_track', track: { id: 'voice', kind: 'audio', name: 'كلام', audio: 'voice' }, index: 2 }, { op: 'set_track', trackId: 'voice', patch: { name: 'بودكاست' } }, { op: 'move_track', trackId: 'voice', index: 1 }]);
  expect(next.tracks[1]).toMatchObject({ id: 'voice', name: 'بودكاست', audio: 'voice' });
  expect(next.clips).toEqual(p.clips);
  expect(() => applyOps(next, [{ op: 'move_track', trackId: 'V1', index: 2 }])).toThrow('first');
});

it('removes only empty tracks without confirmation; confirmed deletion includes the track clips', () => {
  const p = base();
  expect(() => applyOps(p, [{ op: 'remove_track', trackId: 'T1' }])).toThrow('not empty');
  const next = applyOps(p, [{ op: 'remove_track', trackId: 'V2' }, { op: 'remove_track', trackId: 'T1', deleteClips: true }]);
  expect(next.clips.map((c) => c.id)).toEqual(['main']);
  expect(next.tracks.map((t) => t.id)).toEqual(['V1', 'A2']);
  expect(p.clips).toHaveLength(2);
  expect(() => applyOps(p, [{ op: 'remove_track', trackId: 'V1', deleteClips: true }])).toThrow('cannot');
});

it('sound can move between an audio track and V1; text stays on text tracks', () => {
  let p = applyOps(base(), [{ op: 'add_clip', clip: { id: 'a', mediaId: 'voice', trackId: 'A2', start: 3, in: 0, out: 2 } }]);
  p = applyOps(p, [{ op: 'move', clipId: 'a', trackId: 'V1', index: 0 }]);
  expect(p.clips.find((c) => c.id === 'a')).toMatchObject({ trackId: 'V1', start: 0 });
  expect(p.clips.find((c) => c.id === 'main')?.start).toBe(2);
  expect(() => applyOps(p, [{ op: 'move', clipId: 'caption', trackId: 'V2' }])).toThrow("can't go");
  expect(() => applyOps(p, [{ op: 'add_clip', clip: { trackId: 'T1', mediaId: 'voice', in: 0, out: 2 } }])).toThrow('text');
  const empty = Project.parse({ name: 'empty', createdAt: '', tracks: defaultTracks('empty') });
  const withText = applyOps(empty, [{ op: 'add_text', text: 'عنوان', start: 0, duration: 2 }]);
  expect(withText.tracks.filter((t) => t.kind === 'text')).toHaveLength(1);
});
