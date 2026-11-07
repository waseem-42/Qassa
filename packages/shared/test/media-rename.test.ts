import { expect, it } from 'vitest';
import { applyOps, defaultTracks, Op, Project } from '../src/index.ts';

const fixture = () => Project.parse({ name: 'rename', createdAt: '', tracks: defaultTracks(), media: [{ id: 'm', path: 'source/a.wav', name: '��302 تيك توك�', kind: 'audio', role: 'source', duration: 5, hasAudio: true }] });

it('renames a media without touching its file or role', () => {
  const p = applyOps(fixture(), [{ op: 'update_media', mediaId: 'm', patch: { name: '  تيك توك 302  ' } }]);
  expect(p.media[0]).toMatchObject({ name: 'تيك توك 302', path: 'source/a.wav', role: 'source' });
  expect(applyOps(p, [{ op: 'update_media', mediaId: 'm', patch: { role: 'music' } }]).media[0]).toMatchObject({ name: 'تيك توك 302', role: 'music' });
});

it('needs a role or a non-empty name', () => {
  expect(Op.safeParse({ op: 'update_media', mediaId: 'm', patch: {} }).success).toBe(false);
  expect(Op.safeParse({ op: 'update_media', mediaId: 'm', patch: { name: '   ' } }).success).toBe(false);
});
