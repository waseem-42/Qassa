import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, placeAt, Project } from '@edit/shared';
import { keyTimes, toggleKeyPatch, valuesPatch, withKey } from '../src/lib/anim.ts';

const project = () => Project.parse({
  name: 't', createdAt: '2026-01-01', tracks: defaultTracks(),
  media: [{ id: 'v', path: 'a.mp4', role: 'source', kind: 'video', name: 'a', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true }],
  clips: [{ id: 'a', trackId: 'V1', mediaId: 'v', start: 0, in: 0, out: 10 }, { id: 'b', trackId: 'V2', mediaId: 'v', start: 2, in: 0, out: 6, place: { dx: 0.2, dy: 0, scale: 0.4 } }],
});
const clip = (p: Project, id: string) => p.clips.find((c) => c.id === id)!;

describe('keyframes in the editor', () => {
  it('without keys a change sets the fixed value; with keys it sets the key at the playhead', () => {
    let p = project();
    expect(valuesPatch(clip(p, 'b'), { dx: 0.3, opacity: 0.5, volume: 2 }, 1)).toEqual({ place: { dx: 0.3 }, picture: { opacity: 0.5 }, volume: 2 });
    p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: toggleKeyPatch(clip(p, 'b'), 'dx', 0) }]);
    expect(clip(p, 'b').anim!.dx).toEqual([{ t: 0, v: 0.2 }]); // starts from the value it has
    p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: valuesPatch(clip(p, 'b'), { dx: -0.2, dy: 0.1 }, 2) }]);
    expect(clip(p, 'b').anim!.dx).toEqual([{ t: 0, v: 0.2 }, { t: 2, v: -0.2 }]);
    expect(clip(p, 'b').place!.dy).toBe(0.1); // dy has no keys: fixed
    expect(placeAt(clip(p, 'b'), 1).dx).toBeCloseTo(0);
  });
  it('◆ removes the key at the playhead; the last one leaves its value behind', () => {
    let p = applyOps(project(), [{ op: 'update_clip', clipId: 'b', patch: { anim: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } } }]);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: toggleKeyPatch(clip(p, 'b'), 'opacity', 1.02) }]);
    expect(clip(p, 'b').anim!.opacity).toEqual([{ t: 0, v: 0 }]);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: toggleKeyPatch(clip(p, 'b'), 'opacity', 0) }]);
    expect(clip(p, 'b').anim).toBeUndefined();
    expect(clip(p, 'b').picture!.opacity).toBe(0);
  });
  it('keys sort, replace the one right there, and list for jumping', () => {
    expect(withKey([{ t: 2, v: 1 }, { t: 0, v: 0 }], 2.01, 5)).toEqual([{ t: 0, v: 0 }, { t: 2.01, v: 5 }]);
    const p = applyOps(project(), [{ op: 'update_clip', clipId: 'a', patch: { anim: { volume: [{ t: 3, v: 1 }] }, transform: { keyframes: [{ t: 1, scale: 1, x: 0.5, y: 0.5 }, { t: 3, scale: 2, x: 0.5, y: 0.5 }] } } }]);
    expect(keyTimes(clip(p, 'a'))).toEqual([1, 3]);
  });
});
