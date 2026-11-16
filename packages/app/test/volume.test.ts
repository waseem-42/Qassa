import { it, expect } from 'vitest';
import { Project, defaultTracks } from '@edit/shared';
import { volumeOps } from '../src/lib/volume.ts';
it('adjusts selected sound by dB, clamps gain, and skips locked/text clips', () => {
  const p = Project.parse({ name: 'qa', createdAt: '2026-01-01', tracks: defaultTracks(), media: [{ id: 'm', path: 'a.wav', name: 'a', role: 'source', kind: 'audio', hasAudio: true }], clips: [{ id: 'a', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 3 }, { id: 'text', trackId: 'T1', start: 0, in: 0, out: 3, text: 'text' }] });
  expect(volumeOps(p, ['a', 'text'], 1)).toHaveLength(1);
  expect((volumeOps(p, ['a'], 1)[0] as any).patch.volume).toBeCloseTo(10 ** .05);
  expect((volumeOps(p, ['a'], 100)[0] as any).patch.volume).toBe(4);
  p.tracks[0].locked = true; expect(volumeOps(p, ['a'], 1)).toEqual([]);
});
