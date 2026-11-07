import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, ideaSpan, Project } from '../src/index.ts';

function project(): Project {
  return Project.parse({
    name: 't',
    createdAt: '2026-01-01',
    tracks: defaultTracks(),
    media: [
      { id: 'm1', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true },
      { id: 'b1', path: 'source/city.mp4', role: 'broll', kind: 'video', name: 'city', duration: 8, width: 1920, height: 1080, fps: 30, hasAudio: true },
    ],
    clips: [{ id: 'c0', trackId: 'V1', mediaId: 'm1', start: 0, in: 0, out: 60 }],
  });
}

let seq = 0;
const ctx = { newId: (p: string) => `${p}${++seq}` };

describe('visual ideas', () => {
  it('wait in the list pinned to their words, and follow them through cuts', () => {
    let p = applyOps(project(), [{ op: 'add_ideas', items: [
      { mediaId: 'm1', t0: 20, t1: 23, kind: 'text', text: 'ثلاث خطوات', note: 'يلخص الفكرة' },
      { mediaId: 'm1', t0: 10, t1: 12, kind: 'graphic', graphic: 'lib/keys', graphicData: { keys: ['Ctrl', 'S'] }, duration: 3, note: 'اختصار' },
    ] }], ctx);
    expect(p.ideas.map((i) => i.t0)).toEqual([10, 20]); // in the order they are said
    expect(p.clips).toHaveLength(1); // nothing on the timeline yet
    p = applyOps(p, [{ op: 'cut_range', mediaId: 'm1', t0: 0, t1: 5 }], ctx);
    expect(ideaSpan(p, p.ideas[0])).toEqual({ start: 5, end: 8 }); // graphic: its own duration
    expect(ideaSpan(p, p.ideas[1])).toEqual({ start: 15, end: 18 }); // text: as long as its words
    p = applyOps(p, [{ op: 'cut_range', mediaId: 'm1', t0: 19, t1: 24 }], ctx);
    expect(ideaSpan(p, p.ideas[1])).toBeNull(); // its words are gone
  });

  it('refuse ideas that cannot be added', () => {
    const bad = [
      { mediaId: 'nope', t0: 1, t1: 2, kind: 'text' as const, text: 'x', note: '' },
      { mediaId: 'm1', t0: 1, t1: 2, kind: 'graphic' as const, graphic: 'keys', note: '' },
      { mediaId: 'm1', t0: 1, t1: 2, kind: 'broll' as const, note: '' },
      { mediaId: 'm1', t0: 1, t1: 2, kind: 'broll' as const, source: { mediaId: 'm9', in: 0, out: 2 }, note: '' },
      { mediaId: 'm1', t0: 3, t1: 2, kind: 'shot' as const, note: '' },
    ];
    for (const item of bad) expect(() => applyOps(project(), [{ op: 'add_ideas', items: [item] }], ctx)).toThrow(/add_ideas/);
  });

  it('added: a clip on a free track where the words play; a shot leaves a comment; dismissed: just gone', () => {
    let p = applyOps(project(), [
      { op: 'add_clip', clip: { id: 'busy', trackId: 'V2', graphic: 'lib/chapter', in: 0, out: 10, start: 0 } },
      { op: 'add_ideas', items: [
        { id: 'g', mediaId: 'm1', t0: 2, t1: 4, kind: 'graphic', graphic: 'lib/keys', note: '' },
        { id: 'b', mediaId: 'm1', t0: 30, t1: 42, kind: 'broll', source: { mediaId: 'b1', in: 1, out: 8 }, note: '' },
        { id: 's', mediaId: 'm1', t0: 50, t1: 53, kind: 'shot', note: 'لقطة للمدينة من فوق', search: 'city aerial' },
        { id: 'x', mediaId: 'm1', t0: 55, t1: 56, kind: 'text', text: 'لا', note: '' },
      ] },
    ], ctx);
    p = applyOps(p, [{ op: 'resolve_ideas', ids: ['g', 'b', 's'], accept: true }, { op: 'resolve_ideas', ids: ['x'], accept: false }], ctx);
    expect(p.ideas).toEqual([]);
    const g = p.clips.find((c) => c.graphic === 'lib/keys')!;
    expect(g.trackId).not.toBe('V2'); // V2 was busy then: a new overlay track
    expect(p.tracks.find((t) => t.id === g.trackId)?.kind).toBe('overlay');
    expect(p.tracks.findIndex((t) => t.id === g.trackId)).toBe(p.tracks.findIndex((t) => t.id === 'V2') + 1);
    expect(g).toMatchObject({ start: 2, in: 0, out: 2 });
    const b = p.clips.find((c) => c.mediaId === 'b1')!;
    expect(b).toMatchObject({ trackId: 'V2', start: 30, in: 1, out: 8, volume: 0 }); // V2 free at 30s; the b-roll's own length caps it
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]).toMatchObject({ at: 50, end: 53, author: 'claude' });
    expect(p.notes[0].text).toContain('city aerial');
    expect(p.clips.some((c) => c.text === 'لا')).toBe(false);
  });
});
