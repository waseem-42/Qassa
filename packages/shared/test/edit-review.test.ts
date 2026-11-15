import { describe, expect, it } from 'vitest';
import { defaultTracks, editReview, Project, reviewLine, Track } from '../src/index.ts';

const media = [
  { id: 'v', path: 'v.mp4', name: 'talk', kind: 'video', role: 'source', duration: 120, hasAudio: true },
  { id: 'b', path: 'b.mp4', name: 'broll', kind: 'video', role: 'broll', duration: 30, hasAudio: false },
  { id: 'm', path: 'm.mp3', name: 'music', kind: 'audio', role: 'music', duration: 120, hasAudio: true },
];
const main = (pieces: [number, number][]) => {
  let start = 0;
  return pieces.map(([a, b], i) => { const c = { id: `v${i}`, trackId: 'V1', mediaId: 'v', in: a, out: b, start }; start += b - a; return c; });
};
const project = (clips: object[], extra: object = {}) => Project.parse({ name: 'review', createdAt: '', tracks: defaultTracks(), media, clips, ...extra });
const text = (id: string, t: string, start: number, duration: number, style: object = {}) => ({ id, trackId: 'T1', text: t, in: 0, out: duration, start, textStyle: { preset: 'lower-third', x: .92, y: .82, align: 'start', ...style } });
const codes = (p: Project, aspect?: '9:16') => editReview(p, { aspect }).map((f) => f.code);

describe('edit review', () => {
  it('a clean edit has nothing to say', () => {
    expect(editReview(project([...main([[0, 20]]), text('t', 'حاسة السمع', 2, 3)]))).toEqual([]);
  });

  it('flash frames on the main track and on layers, not normal clips', () => {
    const p = project([...main([[0, 10], [10.5, 10.6], [11, 20]]), { id: 'x', trackId: 'V2', mediaId: 'b', in: 0, out: .1, start: 5 }]);
    const flashes = editReview(p).filter((f) => f.code === 'flash_frame');
    expect(flashes.map((f) => f.clipIds[0])).toEqual(['x', 'v1']);
    expect(codes(project(main([[0, 10], [10.5, 11]])))).not.toContain('flash_frame');
  });

  it('text too short to read, Arabic words counted; linked captions are left alone', () => {
    const p = project([...main([[0, 20]]), text('t', 'كيف تنتقل الكلمة من مجرد ذبذبات إلى معاني', 1, 1.2)]);
    const f = editReview(p).find((x) => x.code === 'short_text')!;
    expect(f.clipIds).toEqual(['t']); expect(f.fix).toMatch(/duration:3\.2/);
    const linked = project([...main([[0, 20]]), { ...text('t', 'كيف تنتقل الكلمة من مجرد ذبذبات', 1, 1), words: { mediaId: 'v', from: 0, to: 4 } }]);
    expect(codes(linked)).not.toContain('short_text');
  });

  it('two texts in the same place at the same time collide; apart in time or space they do not', () => {
    const tracks = [...defaultTracks(), Track.parse({ id: 'T2', kind: 'text', name: 'نص ٢' })];
    const second = (start: number, y: number) => ({ ...text('u', 'عنوان ثاني', start, 3, { y }), trackId: 'T2' });
    expect(codes(Project.parse({ name: 'r', createdAt: '', tracks, media, clips: [...main([[0, 20]]), text('t', 'عنوان أول', 2, 3), second(3, .82)] }))).toContain('text_collision');
    expect(codes(Project.parse({ name: 'r', createdAt: '', tracks, media, clips: [...main([[0, 20]]), text('t', 'عنوان أول', 2, 3), second(3, .3)] }))).not.toContain('text_collision');
    expect(codes(Project.parse({ name: 'r', createdAt: '', tracks, media, clips: [...main([[0, 20]]), text('t', 'عنوان أول', 2, 3), second(6, .82)] }))).not.toContain('text_collision');
  });

  it('9:16 only: text under the platform buttons or description', () => {
    const p = project([...main([[0, 20]]), text('t', 'اشترك', 2, 3, { y: .9, x: .5, align: 'center', preset: 'caption' })]);
    expect(codes(p, '9:16')).toContain('unsafe_area');
    expect(codes(p)).not.toContain('unsafe_area');
    expect(codes(project([...main([[0, 20]]), text('t', 'اشترك', 2, 3, { y: .6, x: .5, align: 'center' })]), '9:16')).not.toContain('unsafe_area');
  });

  it('black picture where nothing is on screen; a sound-only edit is one note', () => {
    const p = project([...main([[0, 10]]), { id: 'x', trackId: 'V2', mediaId: 'b', in: 0, out: 5, start: 12 }]);
    const black = editReview(p).filter((f) => f.code === 'black_picture');
    expect(black.map((f) => [f.at, f.end, f.severity])).toEqual([[10, 12, 'warn']]);
    const audio = project([{ id: 'a', trackId: 'V1', mediaId: 'm', in: 0, out: 60, start: 0 }]);
    expect(codes(audio)).toEqual(['audio_only']);
  });

  it('a graphic that paints the whole frame is picture; any other graphic over black is a note, not «sound only»', () => {
    const g = { id: 'g', trackId: 'V2', graphic: 'graphics/film', in: 0, out: 60, start: 0 };
    const voice = { id: 'a', trackId: 'V1', mediaId: 'm', in: 0, out: 60, start: 0 };
    const p = project([voice, g]);
    expect(editReview(p, { opaque: (x) => x === 'graphics/film' })).toEqual([]);
    expect(editReview(p).map((f) => [f.code, f.severity])).toEqual([['black_picture', 'info']]);
    const small = project([voice, { ...g, place: { scale: .4 } }]);
    expect(editReview(small, { opaque: () => true }).map((f) => f.code)).toEqual(['black_picture']);
  });

  it('loud music only matters under speech', () => {
    const loud = { id: 'mm', trackId: 'A2', mediaId: 'm', in: 0, out: 20, start: 0, volume: 1 };
    expect(codes(project([...main([[0, 20]]), loud]))).toContain('loud_music');
    expect(codes(project([...main([[0, 20]]), { ...loud, volume: .35 }]))).not.toContain('loud_music');
    expect(codes(project([...main([[0, 5]]), { ...loud, start: 6 }]))).not.toContain('loud_music');
  });

  it('more than three same-shot jump cuts within 10 s, unless the framing changes', () => {
    const run = main([[0, 2], [3, 5], [6, 8], [9, 11], [12, 14], [15, 30]]);
    const f = editReview(project(run)).find((x) => x.code === 'jump_cuts')!;
    expect(f.message).toMatch(/^5/);
    const zoomed = run.map((c, i) => (i % 2 ? { ...c, transform: { scale: 1.1, x: .5, y: .5 } } : c));
    expect(codes(project(zoomed))).not.toContain('jump_cuts');
    expect(codes(project(main([[0, 2], [3, 5], [6, 8], [9, 30]])))).not.toContain('jump_cuts');
  });

  it('overlaps, open comments and waiting ideas are listed with their time', () => {
    const p = project([...main([[0, 20]]), { id: 'x', trackId: 'V2', mediaId: 'b', in: 0, out: 4, start: 2 }, { id: 'y', trackId: 'V2', mediaId: 'b', in: 0, out: 4, start: 4 }], {
      notes: [{ id: 'n', at: 7, text: 'كبّر هنا' }],
      ideas: [{ id: 'i', mediaId: 'v', t0: 1, t1: 2, kind: 'text', note: 'عنوان', text: 'عنوان' }],
    });
    const r = editReview(p);
    expect(r.find((f) => f.code === 'overlap')).toMatchObject({ at: 4, end: 6, clipIds: ['x', 'y'], severity: 'warn' });
    expect(r.find((f) => f.code === 'open_note')!.at).toBe(7);
    expect(codes(p)).toContain('pending_ideas');
    expect(reviewLine(r[0])).toMatch(/^⚠ .*overlap/);
  });
});
