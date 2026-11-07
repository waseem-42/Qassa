import { expect, it } from 'vitest';
import { applyOps, defaultTracks, mediaPlacementOps, Project } from '../src/index.ts';

it('switches picture off without changing timing, sound, framing or anchored content; can restore it', () => {
  const p = Project.parse({ name: 'sound', createdAt: '', tracks: defaultTracks(), media: [{ id: 'm', path: 'a.mp4', name: 'a', role: 'source', kind: 'video', duration: 10, hasAudio: true }], clips: [{ id: 'a', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 5, picture: { rotate: 20 } }, { id: 'b', trackId: 'V1', mediaId: 'm', start: 5, in: 5, out: 10 }, { id: 'text', trackId: 'T1', text: 'فوقه', start: 2, in: 0, out: 2 }] });
  const off = applyOps(p, [{ op: 'update_clip', clipId: 'a', patch: { picture: { off: true } } }]);
  expect(off.clips.map((c) => [c.start, c.in, c.out, c.volume])).toEqual(p.clips.map((c) => [c.start, c.in, c.out, c.volume]));
  expect(off.clips[0].picture).toMatchObject({ rotate: 20, off: true });
  const restored = applyOps(off, [{ op: 'update_clip', clipId: 'a', patch: { picture: { off: false } } }]);
  expect(restored.clips[0].picture).toMatchObject({ rotate: 20, off: false });
  const added = applyOps(p, mediaPlacementOps(p, p.media[0], { soundOnly: true, at: 2 }));
  const sound = added.clips.at(-1)!;
  expect(added.tracks.find((t) => t.id === sound.trackId)).toMatchObject({ kind: 'audio', audio: 'voice' });
  expect(sound).toMatchObject({ start: 2, picture: { off: true }, volume: 1 });
  expect(() => applyOps(p, [{ op: 'add_clip', clip: { trackId: 'A2', mediaId: 'm', in: 0, out: 1 } }])).not.toThrow();
  expect(() => applyOps({ ...p, media: [{ ...p.media[0], hasAudio: false }] }, [{ op: 'add_clip', clip: { trackId: 'A2', mediaId: 'm', in: 0, out: 1 } }])).toThrow('sound');
});
