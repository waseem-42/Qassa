import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, Project } from '@edit/shared';
import { lookOf, pasteLookOps } from '../src/lib/look.ts';

const project = () => applyOps(Project.parse({
  name: 't', createdAt: '2026-01-01', tracks: defaultTracks(),
  media: [
    { id: 'v', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true },
    { id: 'mu', path: 'source/m.mp3', role: 'music', kind: 'audio', name: 'm', duration: 60, hasAudio: true },
  ],
  clips: [
    { id: 'a', trackId: 'V1', mediaId: 'v', start: 0, in: 0, out: 10 },
    { id: 'b', trackId: 'V1', mediaId: 'v', start: 10, in: 20, out: 30, grade: { contrast: 1.4 } },
    { id: 'pip', trackId: 'V2', mediaId: 'v', start: 2, in: 0, out: 3, place: { scale: 0.35, dx: 0.3, dy: 0.3 } },
    { id: 'pip2', trackId: 'V2', mediaId: 'v', start: 6, in: 0, out: 3 },
    { id: 'music', trackId: 'A2', mediaId: 'mu', start: 0, in: 0, out: 20 },
  ],
}), [{ op: 'add_text', text: 'x', start: 1, duration: 2, style: { preset: 'card', color: '#ff0000' } }]);

describe('copy / paste a look', () => {
  it('gives the target the same colours, zoom, picture and sound — and removes what the source does not have', () => {
    let p = applyOps(project(), [{ op: 'update_clip', clipId: 'a', patch: { picture: { fit: 'fit', bars: 'blur' }, transform: { scale: 1.3 }, volume: 0.5, fadeIn: 1 } }]);
    const ops = pasteLookOps(p, lookOf(p.clips.find((c) => c.id === 'a')!), ['a', 'b']);
    expect(ops).toHaveLength(1); // the source itself is skipped
    p = applyOps(p, ops);
    const b = p.clips.find((c) => c.id === 'b')!;
    expect(b.grade).toBeUndefined();
    expect(b).toMatchObject({ volume: 0.5, fadeIn: 1, transform: { scale: 1.3 }, picture: { fit: 'fit', bars: 'blur' }, in: 20, out: 30 });
  });
  it('a picture-in-picture place goes to other layers only; sound-only clips take just the sound', () => {
    const p = project();
    const look = lookOf(p.clips.find((c) => c.id === 'pip')!);
    const ops = pasteLookOps(p, look, ['a', 'pip2', 'music']);
    const by = Object.fromEntries(ops.map((o) => [(o as { clipId: string }).clipId, (o as { patch: object }).patch]));
    expect(by.pip2).toMatchObject({ place: { scale: 0.35 } });
    expect(by.a).not.toHaveProperty('place');
    expect(Object.keys(by.music).sort()).toEqual(['anim', 'denoise', 'volume']);
    expect(by.music).toMatchObject({ anim: { volume: null } });
  });
  it('a clip whose sound was detached passes on its look, not its silence', () => {
    const p = applyOps(project(), [{ op: 'detach_audio', clipId: 'a' }]);
    expect(pasteLookOps(p, lookOf(p.clips.find((c) => c.id === 'a')!), ['b'])[0]).not.toHaveProperty('patch.volume');
  });
  it('a text passes its style to other texts only', () => {
    let p = applyOps(project(), [{ op: 'add_text', text: 'y', start: 5, duration: 2 }]);
    const [t1, t2] = p.clips.filter((c) => c.text);
    const ops = pasteLookOps(p, lookOf(t1), [t2.id, 'a']);
    expect(ops).toHaveLength(1);
    p = applyOps(p, ops);
    expect(p.clips.find((c) => c.id === t2.id)!.textStyle).toMatchObject({ preset: 'card', color: '#ff0000' });
    expect(p.clips.find((c) => c.id === t2.id)!.text).toBe('y');
  });
});
