import { expect, it } from 'vitest';
import { applyOps, defaultTracks, guessedRole, mainInsertion, mediaPlacementOps, Media, Project } from '../src/index.ts';

it('changing a media role leaves placed clips and their anchored timing alone', () => {
  const p = Project.parse({ name: 'roles', createdAt: '', tracks: defaultTracks(), media: [{ id: 'm', name: 'a', path: 'a.mp4', role: 'source', kind: 'video', duration: 10 }], clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 1, out: 5 }, { id: 'title', trackId: 'T1', text: 'عنوان', start: 2, in: 0, out: 1 }] });
  const next = applyOps(p, [{ op: 'update_media', mediaId: 'm', patch: { role: 'ref' } }]);
  expect(next.media[0].role).toBe('ref'); expect(next.clips).toEqual(p.clips);
  expect(() => applyOps(p, [{ op: 'update_media', mediaId: 'missing', patch: { role: 'ref' } }])).toThrow('not found');
});

it('a voice can start the story; subsequent audio becomes music, and magnetic drops choose boundaries', () => {
  const p = Project.parse({ name: 'import', createdAt: '', tracks: defaultTracks('empty') });
  const m = Media.parse({ id: 'm', name: 'voice', path: 'a.wav', role: guessedRole(p, 'audio'), kind: 'audio', duration: 10, hasAudio: true });
  const next = applyOps({ ...p, media: [m] }, mediaPlacementOps(p, m));
  expect(next.clips[0].trackId).toBe('V1');
  expect(guessedRole(next, 'audio')).toBe('music'); expect(guessedRole(next, 'image')).toBe('broll');
  expect(mainInsertion(next, 4.9)).toEqual({ index: 0, at: 0 });
  expect(mainInsertion(next, 5.1)).toEqual({ index: 1, at: 10 });
});
