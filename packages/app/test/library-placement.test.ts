import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Media } from '@edit/shared';
import { Store } from '../../server/src/store.ts';
import { libraryPlacementOps } from '../src/lib/library-placement.ts';

it('places only library videos/images on V1 in library order, with one undo and redo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qassa-library-'));
  const store = new Store(root, { watch: false });
  try {
    store.create('library');
    const media = [
      { id: 'a', kind: 'audio', duration: 8, role: 'source' },
      { id: 'v', kind: 'video', duration: 3, role: 'broll' },
      { id: 'i', kind: 'image', duration: 0, role: 'ref' },
      { id: 'v2', kind: 'video', duration: 2, role: 'source' },
    ].map((m) => Media.parse({ ...m, name: m.id, path: `${m.id}.mp4` }));
    store.mutate('library', (p) => { p.media = media; });
    const before = store.get('library').project;
    const history = store.history('library').undo;
    store.apply('library', libraryPlacementOps(before), 'user');
    const placed = store.get('library').project;
    expect(placed.clips.map((c) => [c.trackId, c.mediaId, c.start, c.out])).toEqual([['V1', 'v', 0, 3], ['V1', 'i', 3, 5], ['V1', 'v2', 8, 2]]);
    expect(store.history('library').undo).toBe(history + 1);
    store.undo('library');
    expect(store.get('library').project).toEqual(before);
    store.redo('library');
    expect(store.get('library').project).toEqual(placed);
    expect(libraryPlacementOps({ ...before, media: [media[0]] })).toEqual([]);
  } finally { await store.close(); rmSync(root, { recursive: true, force: true }); }
});
