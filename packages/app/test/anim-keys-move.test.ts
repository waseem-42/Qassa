import { expect, it } from 'vitest';
import { applyOps, defaultTracks, Project } from '@edit/shared';
import { deleteKeysPatch, keyTimes, moveKeysPatch } from '../src/lib/anim.ts';

const project = () => Project.parse({
  name: 't', createdAt: '2026-01-01', tracks: defaultTracks(),
  media: [{ id: 'v', path: 'a.mp4', role: 'source', kind: 'video', name: 'a', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true }],
  clips: [{
    id: 'b', trackId: 'V2', mediaId: 'v', start: 2, in: 0, out: 6,
    anim: { dx: [{ t: 0, v: 0.2 }, { t: 2, v: -0.2 }], opacity: [{ t: 2, v: 0.5 }] },
    transform: { scale: 1, x: 0.5, y: 0.5, keyframes: [{ t: 2, scale: 1.5, x: 0.4, y: 0.5 }, { t: 4, scale: 1, x: 0.5, y: 0.5 }] },
  }],
});
const clip = (p: Project) => p.clips[0];

it('dragging a ◆ moves every key at that moment, zoom included, and stays inside the clip', () => {
  let p = project();
  p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: moveKeysPatch(clip(p), 2, 3.5) }]);
  expect(clip(p).anim!.dx).toEqual([{ t: 0, v: 0.2 }, { t: 3.5, v: -0.2 }]);
  expect(clip(p).anim!.opacity).toEqual([{ t: 3.5, v: 0.5 }]);
  expect(clip(p).transform!.keyframes.map((k) => k.t)).toEqual([3.5, 4]);
  // onto another key: that one gives way; past the end: the clip's last moment
  p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: moveKeysPatch(clip(p), 3.5, 4) }]);
  expect(clip(p).transform!.keyframes).toEqual([{ t: 4, scale: 1.5, x: 0.4, y: 0.5 }]);
  p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: moveKeysPatch(clip(p), 0, 99) }]);
  expect(keyTimes(clip(p))).toEqual([4, 6]);
});

it('deleting a ◆ removes its keys; a property losing its last key keeps that value', () => {
  let p = project();
  p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: deleteKeysPatch(clip(p), 2) }]);
  expect(clip(p).anim!.dx).toEqual([{ t: 0, v: 0.2 }]);
  expect(clip(p).anim!.opacity).toBeUndefined();
  expect(clip(p).picture!.opacity).toBe(0.5);
  expect(clip(p).transform!.keyframes.map((k) => k.t)).toEqual([4]);
  p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: deleteKeysPatch(clip(p), 4) }]);
  expect(clip(p).transform).toMatchObject({ keyframes: [], scale: 1, x: 0.5 });
  expect(keyTimes(clip(p))).toEqual([0]);
});
