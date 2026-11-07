import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, mainClips, Project } from '@edit/shared';
import { duplicateOps, pasteOps } from '../src/lib/clipboard.ts';

const project = () => applyOps(Project.parse({
  name: 't', createdAt: '2026-01-01', tracks: defaultTracks(),
  media: [{ id: 'v', path: 'a.mp4', role: 'source', kind: 'video', name: 'a', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true }],
  clips: [
    { id: 'a', trackId: 'V1', mediaId: 'v', start: 0, in: 0, out: 10 },
    { id: 'b', trackId: 'V1', mediaId: 'v', start: 10, in: 20, out: 25, grade: { contrast: 1.3 }, transition: { kind: 'crossfade', duration: 0.5 } },
    { id: 'pip', trackId: 'V2', mediaId: 'v', start: 2, in: 0, out: 3, place: { dx: 0.3, dy: 0, scale: 0.35 } },
  ],
}), [{ op: 'add_text', text: 'عنوان', start: 4, duration: 2 }]);

describe('clip clipboard', () => {
  it('paste and duplicate route a copy onto a free layer when its destination is occupied', () => {
    const p = project(), clip = p.clips.find((c) => c.id === 'pip')!;
    const busy = applyOps(p, [{ op: 'add_clip', clip: { ...clip, id: 'busy', start: 5 } }]);
    for (const plan of [pasteOps(busy, [clip], 5), duplicateOps(busy, [clip.id])]) {
      const next = applyOps(busy, plan.ops), copy = next.clips.find((c) => c.id === plan.ids[0])!;
      expect(copy.start).toBe(5); expect(copy.trackId).not.toBe(clip.trackId);
      expect(next.clips.filter((c) => c.trackId === clip.trackId)).toHaveLength(2);
    }
  });
  it('pastes layers at the playhead with their spacing, and main clips at the nearest cut, with all their settings', () => {
    let p = project();
    const text = p.clips.find((c) => c.text)!;
    const { ops, ids: made } = pasteOps(p, [p.clips.find((c) => c.id === 'pip')!, text, p.clips.find((c) => c.id === 'b')!], 12);
    p = applyOps(p, ops);
    const ids = [made[1], made[2], made[0]]; // made: main first, then layers
    const added = ids.map((id) => p.clips.find((c) => c.id === id)!);
    expect(added.map((c) => [c.trackId, c.start])).toEqual([['V2', 12], ['T1', 14], ['V1', 10]]); // the copy of b goes in before b (12 is in its first half)
    expect(added[0].place).toMatchObject({ scale: 0.35 });
    expect(added[2]).toMatchObject({ in: 20, out: 25, grade: { contrast: 1.3 } });
    expect(added[2].transition).toBeUndefined();
    expect(mainClips(p).map((c) => c.id)).toEqual(['a', ids[2], 'b']);
  });
  it('duplicates right after each clip', () => {
    let p = project();
    const { ops, ids } = duplicateOps(p, ['a', 'pip']);
    p = applyOps(p, ops);
    expect(mainClips(p).map((c) => c.id)).toEqual(['a', ids[0], 'b']);
    expect(p.clips.find((c) => c.id === ids[1])).toMatchObject({ trackId: 'V2', start: 5, in: 0, out: 3 });
  });
});
