import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, keptRanges, mainClips, OpBatch, Project, wordStates, type Word } from '../src/index.ts';

function project(): Project {
  let n = 0;
  return Project.parse({
    name: 't',
    createdAt: '2026-01-01',
    tracks: defaultTracks(),
    media: [{ id: 'm1', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 60, width: 1920, height: 1080, fps: 30, hasAudio: true }],
    clips: [{ id: 'c' + n++, trackId: 'V1', mediaId: 'm1', start: 0, in: 0, out: 60 }],
  });
}

let seq = 0;
const ctx = { newId: (p: string) => `${p}${++seq}` };

describe('ops', () => {
  it('cut_range splits the main clip and ripples', () => {
    const p = applyOps(project(), [{ op: 'cut_range', mediaId: 'm1', t0: 10, t1: 20 }], ctx);
    const clips = mainClips(p);
    expect(clips.map((c) => [c.start, c.in, c.out])).toEqual([[0, 0, 10], [10, 20, 60]]);
    expect(keptRanges(p, 'm1')).toEqual([[0, 10], [20, 60]]);
  });

  it('restore_range brings the cut back and merges the pieces', () => {
    let p = applyOps(project(), [{ op: 'cut_range', mediaId: 'm1', t0: 10, t1: 20 }], ctx);
    p = applyOps(p, [{ op: 'restore_range', mediaId: 'm1', t0: 10, t1: 20 }], ctx);
    expect(mainClips(p).map((c) => [c.start, c.in, c.out])).toEqual([[0, 0, 60]]);
  });

  it('restore part of a cut', () => {
    let p = applyOps(project(), [{ op: 'cut_range', mediaId: 'm1', t0: 10, t1: 20 }], ctx);
    p = applyOps(p, [{ op: 'restore_range', mediaId: 'm1', t0: 15, t1: 20 }], ctx);
    expect(keptRanges(p, 'm1')).toEqual([[0, 10], [15, 60]]);
  });

  it('free clips follow their content when the main track ripples', () => {
    let p = applyOps(project(), [{ op: 'add_text', text: 'مرحبا', start: 30, duration: 3 }], ctx);
    p = applyOps(p, [{ op: 'cut_range', mediaId: 'm1', t0: 5, t1: 15 }], ctx);
    expect(p.clips.find((c) => c.text)?.start).toBe(20);
  });

  it('cut_words uses word timings with padding', () => {
    const words: Word[] = [
      { i: 0, t0: 1, t1: 1.5, w: 'أ' },
      { i: 1, t0: 2, t1: 2.5, w: 'ب' },
      { i: 2, t0: 3, t1: 3.5, w: 'ج' },
    ];
    const p = applyOps(project(), [{ op: 'cut_words', mediaId: 'm1', from: 1, to: 1 }], { ...ctx, words: () => words });
    expect(wordStates(p, 'm1', words)).toEqual(['keep', 'cut', 'keep']);
  });

  it('split, reorder and delete keep the main track packed', () => {
    let p = applyOps(project(), [{ op: 'split', clipId: 'c0', at: 20 }], ctx);
    const [a, b] = mainClips(p);
    p = applyOps(p, [{ op: 'reorder', clipId: b.id, index: 0 }], ctx);
    expect(mainClips(p).map((c) => [c.start, c.in, c.out])).toEqual([[0, 20, 60], [40, 0, 20]]);
    p = applyOps(p, [{ op: 'delete', clipId: a.id }], ctx);
    expect(mainClips(p).map((c) => [c.start, c.in, c.out])).toEqual([[0, 20, 60]]);
  });

  it('accepting suggestions cuts them', () => {
    let p = applyOps(project(), [{ op: 'add_suggestions', items: [{ mediaId: 'm1', t0: 1, t1: 2, reason: 'silence' }, { mediaId: 'm1', t0: 5, t1: 7, reason: 'retake' }] }], ctx);
    expect(p.suggestions).toHaveLength(2);
    p = applyOps(p, [{ op: 'resolve_suggestions', ids: 'all', accept: true }], ctx);
    expect(p.suggestions).toHaveLength(0);
    expect(keptRanges(p, 'm1')).toEqual([[0, 1], [2, 5], [7, 60]]);
  });

  it('set_grade and trim validation', () => {
    const p = applyOps(project(), [{ op: 'set_grade', grade: { saturation: 1.2 } }], ctx);
    expect(p.clips[0].grade?.saturation).toBe(1.2);
    expect(() => applyOps(p, [{ op: 'trim', clipId: 'c0', out: 90 }], ctx)).toThrow();
  });
});

describe('clips and tracks', () => {
  it('keep_only rebuilds the main track from source ranges, in source order', () => {
    const p = applyOps(project(), [{ op: 'keep_only', mediaId: 'm1', ranges: [[40, 50], [5, 10], [20, 20]] }], ctx);
    expect(mainClips(p).map((c) => [c.start, c.in, c.out])).toEqual([[0, 5, 10], [5, 40, 50]]);
  });

  it('keep_only moves free clips with their content and parks orphans on the next kept moment', () => {
    let p = applyOps(project(), [{ op: 'add_text', text: 'باقي', start: 42, duration: 2 }, { op: 'add_text', text: 'مقصوص', start: 30, duration: 2 }], ctx);
    p = applyOps(p, [{ op: 'keep_only', mediaId: 'm1', ranges: [[5, 10], [40, 50]] }], ctx);
    expect(p.clips.find((c) => c.text === 'باقي')?.start).toBe(7);
    expect(p.clips.find((c) => c.text === 'مقصوص')?.start).toBe(5);
  });

  it('move repositions free clips but refuses to free-place main-track clips', () => {
    let p = applyOps(project(), [{ op: 'add_text', text: 'x', start: 3, duration: 2 }], ctx);
    const t = p.clips.find((c) => c.text)!;
    p = applyOps(p, [{ op: 'add_track', track: { id: 'T2', kind: 'text', name: 'نص' } }, { op: 'move', clipId: t.id, start: 12, trackId: 'T2' }], ctx);
    expect(p.clips.find((c) => c.id === t.id)).toMatchObject({ start: 12, trackId: 'T2' });
    expect(() => applyOps(p, [{ op: 'move', clipId: 'c0', start: 5 }], ctx)).toThrow(/reorder/);
    expect(() => applyOps(p, [{ op: 'move', clipId: t.id, trackId: 'V1' }], ctx)).toThrow(/main track/);
    expect(() => applyOps(p, [{ op: 'move', clipId: t.id, trackId: 'nope' }], ctx)).toThrow(/not found/);
  });

  it('update_clip merges grade/transform/textStyle and null resets them', () => {
    let p = applyOps(project(), [{ op: 'update_clip', clipId: 'c0', patch: { volume: 0.5, grade: { contrast: 1.2 }, transform: { scale: 1.1 } } }], ctx);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'c0', patch: { grade: { saturation: 0.8 } } }], ctx);
    expect(p.clips[0]).toMatchObject({ volume: 0.5, grade: { contrast: 1.2, saturation: 0.8 }, transform: { scale: 1.1, x: 0.5 } });
    p = applyOps(p, [{ op: 'update_clip', clipId: 'c0', patch: { grade: null, transform: null } }], ctx);
    expect(p.clips[0].grade).toBeUndefined();
    expect(p.clips[0].transform).toBeUndefined();

    p = applyOps(p, [{ op: 'add_text', text: 'x', start: 1, duration: 2, style: { preset: 'card', background: '#000' } }], ctx);
    const t = p.clips.find((c) => c.text)!;
    p = applyOps(p, [{ op: 'update_clip', clipId: t.id, patch: { textStyle: { color: '#ff0', background: null } } }], ctx);
    expect(p.clips.find((c) => c.id === t.id)?.textStyle).toMatchObject({ preset: 'card', color: '#ff0' });
    expect(p.clips.find((c) => c.id === t.id)?.textStyle?.background).toBeUndefined();
  });

  it('set_settings patches settings and defaultGrade, null removes it', () => {
    let p = applyOps(project(), [{ op: 'set_settings', patch: { aspect: '9:16', defaultGrade: { exposure: 0.1 } } }], ctx);
    expect(p.settings).toMatchObject({ aspect: '9:16', fps: 30, defaultGrade: { exposure: 0.1, contrast: 1 } });
    p = applyOps(p, [{ op: 'set_settings', patch: { defaultGrade: null } }], ctx);
    expect(p.settings.defaultGrade).toBeUndefined();
    expect(p.settings.aspect).toBe('9:16');
  });

  it('add_track is idempotent and never adds a second magnetic track; set_track and clear_track', () => {
    let p = applyOps(project(), [{ op: 'add_track', track: { id: 'T2', kind: 'text', name: 'وسوم' }, index: 3 }], ctx);
    p = applyOps(p, [{ op: 'add_track', track: { id: 'T2', kind: 'text', name: 'مكرر' } }], ctx);
    expect(p.tracks.map((t) => t.id)).toEqual(['V1', 'V2', 'T1', 'T2', 'A2']);
    expect(p.tracks[3]).toMatchObject({ name: 'وسوم', magnetic: false });
    expect(() => applyOps(p, [{ op: 'add_track', track: { id: 'V9', kind: 'video', name: 'x', magnetic: true } }], ctx)).toThrow();

    p = applyOps(p, [{ op: 'set_track', trackId: 'T2', patch: { hidden: true } }], ctx);
    expect(p.tracks[3].hidden).toBe(true);

    p = applyOps(p, [{ op: 'add_text', text: 'a', start: 1, duration: 1, trackId: 'T2' }, { op: 'add_text', text: 'b', start: 2, duration: 1 }], ctx);
    p = applyOps(p, [{ op: 'clear_track', trackId: 'T2' }], ctx);
    expect(p.clips.filter((c) => c.text).map((c) => c.text)).toEqual(['b']);
    expect(() => applyOps(p, [{ op: 'clear_track', trackId: 'V1' }], ctx)).toThrow();
  });

  it('graphic clips go on overlay tracks, follow their content and keep their page time when split', async () => {
    const { graphicEntry, graphicTime } = await import('../src/graphics.ts');
    expect(() => applyOps(project(), [{ op: 'add_clip', clip: { trackId: 'V1', graphic: 'graphics/steps', in: 0, out: 10 } }], ctx)).toThrow(/overlay/);
    let p = applyOps(project(), [{ op: 'add_clip', clip: { trackId: 'V2', graphic: 'graphics/steps', start: 30, in: 0, out: 10 } }], ctx);
    const g = p.clips.find((c) => c.graphic)!;
    expect(g).toMatchObject({ in: 0, out: 10, start: 30 });
    p = applyOps(p, [{ op: 'cut_range', mediaId: 'm1', t0: 0, t1: 10 }], ctx);
    expect(p.clips.find((c) => c.id === g.id)?.start).toBe(20);
    p = applyOps(p, [{ op: 'split', clipId: g.id, at: 24 }], ctx);
    const parts = p.clips.filter((c) => c.graphic).sort((a, b) => a.start - b.start);
    expect(parts.map((c) => [c.start, c.in, c.out])).toEqual([[20, 0, 4], [24, 4, 10]]);
    expect(graphicTime(parts[1], 25)).toBe(5);
    expect(graphicEntry('graphics/steps/')).toBe('graphics/steps/index.html');
    expect(graphicEntry('graphics\\a\\intro.html')).toBe('graphics/a/intro.html');
  });

  it('retime_graphic plays scenes longer, each piece keeps its part of the page and pieces stay together', async () => {
    const { graphicPageDuration, graphicQuery, graphicTime, pageToRetimed, retimedToPage } = await import('../src/graphics.ts');
    const r = { from: [0, 2, 6], to: [0, 4, 8] };
    expect(retimedToPage(r, 3)).toBe(1.5);
    expect(pageToRetimed(r, 4)).toBe(6);
    expect(retimedToPage(r, 9)).toBe(7); // past the last edge: 1:1
    let p = applyOps(project(), [{ op: 'add_clip', clip: { id: 'g', trackId: 'V2', graphic: 'lib/steps', start: 10, in: 0, out: 6 } }], ctx);
    p = applyOps(p, [{ op: 'split', clipId: 'g', at: 12 }], ctx);
    const [a, b] = p.clips.filter((c) => c.graphic).sort((x, y) => x.start - y.start);
    // split pins the page length: both pieces still play one 6s page
    expect([graphicPageDuration(a), graphicPageDuration(b)]).toEqual([6, 6]);
    expect(graphicQuery(a, { width: 1920, height: 1080 }).startsWith('duration=6&')).toBe(true);
    p = applyOps(p, [{ op: 'retime_graphic', clipIds: [a.id, b.id], from: r.from, to: r.to }], ctx);
    const [a2, b2] = p.clips.filter((c) => c.graphic).sort((x, y) => x.start - y.start);
    expect([a2.start, a2.in, a2.out]).toEqual([10, 0, 4]); // page 0-2 now lasts 4s
    expect([b2.start, b2.in, b2.out]).toEqual([14, 4, 8]); // follows it
    expect(graphicTime(b2, 16)).toBe(4);
    p = applyOps(p, [{ op: 'retime_graphic', clipIds: [a.id, b.id], from: r.from, to: null }], ctx);
    expect(p.clips.filter((c) => c.graphic).sort((x, y) => x.start - y.start).map((c) => [c.start, c.in, c.out, c.retime])).toEqual([[10, 0, 2, undefined], [12, 2, 6, undefined]]);
    expect(() => applyOps(p, [{ op: 'retime_graphic', clipIds: [a.id], from: [0, 2], to: [0, 2, 3] }], ctx)).toThrow();
  });

  it('retime with hold plays a longer scene at normal speed then holds; a shorter one still speeds up', async () => {
    const { pageToRetimed, retimedToPage } = await import('../src/graphics.ts');
    const r = { from: [0, 2, 6], to: [0, 5, 7], hold: true }; // scene 1: 2s → 5s, scene 2: 4s → 2s
    expect(retimedToPage(r, 1)).toBe(1); // motion at 1:1
    expect(retimedToPage(r, 2)).toBe(2);
    expect(retimedToPage(r, 4)).toBe(2); // holding the last frame of scene 1
    expect(retimedToPage(r, 6)).toBe(4); // scene 2 twice as fast
    expect(retimedToPage(r, 8)).toBe(7); // past the end: 1:1
    expect(pageToRetimed(r, 1)).toBe(1);
    expect(pageToRetimed(r, 2)).toBe(5); // an edge maps to its edge
    expect(pageToRetimed(r, 4)).toBe(6);
    let p = applyOps(project(), [{ op: 'add_clip', clip: { id: 'g', trackId: 'V2', graphic: 'lib/steps', start: 10, in: 0, out: 6 } }], ctx);
    p = applyOps(p, [{ op: 'retime_graphic', clipIds: ['g'], from: r.from, to: r.to, hold: true }], ctx);
    const g = p.clips.find((c) => c.id === 'g')!;
    expect([g.start, g.in, g.out, g.retime?.hold]).toEqual([10, 0, 7, true]);
  });

  it('update_clip sets and clears hand edits of a graphic; the page gets them in its query', async () => {
    const { graphicQuery } = await import('../src/graphics.ts');
    let p = applyOps(project(), [{ op: 'add_clip', clip: { id: 'g', trackId: 'V2', graphic: 'lib/keys', start: 1, in: 0, out: 3 } }], ctx);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'g', patch: { graphicEdits: [{ target: '#title', text: 'مرحبا', dx: 40 }] } }], ctx);
    const g = p.clips.find((c) => c.id === 'g')!;
    expect(g.graphicEdits).toEqual([{ target: '#title', text: 'مرحبا', dx: 40 }]);
    const q = new URLSearchParams(graphicQuery(g, { width: 1920, height: 1080 }));
    expect(JSON.parse(q.get('edits')!)).toEqual(g.graphicEdits);
    expect(new URLSearchParams(graphicQuery(g, { width: 1920, height: 1080 }, undefined, { edits: false })).has('edits')).toBe(false);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'g', patch: { graphicEdits: null } }], ctx);
    expect(p.clips.find((c) => c.id === 'g')!.graphicEdits).toBeUndefined();
  });

  it('library templates and graphicData resolve to the URL both hosts load', async () => {
    const { graphicUrl, isLibraryGraphic } = await import('../src/graphics.ts');
    const base = { width: 1920, height: 1080 };
    expect(isLibraryGraphic('lib/keys')).toBe(true);
    expect(graphicUrl('my proj', { graphic: 'graphics/intro', out: 4 }, base)).toBe('/files/my%20proj/graphics/intro/index.html?duration=4&width=1920&height=1080');
    const url = graphicUrl('p', { graphic: 'lib/keys', out: 3, graphicData: { keys: ['Ctrl', 'D'], label: 'تكرار' } }, base);
    expect(url.startsWith('/graphics-lib/keys/index.html?duration=3&')).toBe(true);
    expect(JSON.parse(new URL(url, 'http://x').searchParams.get('data')!)).toEqual({ keys: ['Ctrl', 'D'], label: 'تكرار' });
    const p = applyOps(project(), [{ op: 'add_clip', clip: { id: 'g', trackId: 'V2', graphic: 'lib/keys', graphicData: { keys: ['A'] }, start: 1, in: 0, out: 3 } }], ctx);
    expect(applyOps(p, [{ op: 'update_clip', clipId: 'g', patch: { graphicData: { keys: ['B'] } } }], ctx).clips.find((c) => c.id === 'g')?.graphicData).toEqual({ keys: ['B'] });
  });

  it('set_settings merges the theme; text presets follow its colours and the text direction', async () => {
    const { textBoxStyle, textDirection } = await import('../src/text.ts');
    const p = applyOps(project(), [{ op: 'set_settings', patch: { theme: { accent: '#22c55e' } } }], ctx);
    expect(p.settings.theme).toMatchObject({ accent: '#22c55e', text: '#ffffff', direction: 'auto' });
    expect(textDirection('  «مرحبا» Blender')).toBe('rtl');
    expect(textDirection('3. Open Blender مرحبا')).toBe('ltr');
    expect(textDirection('Hello', { direction: 'rtl' })).toBe('rtl');
    const label = textBoxStyle({ text: 'Save', textStyle: { preset: 'label', align: 'start' } as never }, 1080, p.settings.theme);
    expect(label).toContain('background:#22c55e');
    expect(label).toContain('direction:ltr');
    expect(label).toContain('translate(0%,-50%)'); // LTR start = anchored on its left edge
    expect(textBoxStyle({ text: 'حفظ', textStyle: { preset: 'label', align: 'start' } as never }, 1080)).toContain('translate(-100%,-50%)');
  });

  it('set_timing moves / resizes a free clip without touching its in-point, and refuses the main track', () => {
    let p = applyOps(project(), [{ op: 'add_clip', clip: { id: 'g', trackId: 'V2', graphic: 'lib/steps', start: 20, in: 1, out: 9 } }], ctx);
    p = applyOps(p, [{ op: 'set_timing', clipId: 'g', start: 25, duration: 4 }], ctx);
    expect(p.clips.find((c) => c.id === 'g')).toMatchObject({ start: 25, in: 1, out: 5 });
    p = applyOps(p, [{ op: 'cut_range', mediaId: 'm1', t0: 0, t1: 5 }], ctx);
    expect(p.clips.find((c) => c.id === 'g')?.start).toBe(20); // still follows its content
    expect(() => applyOps(p, [{ op: 'set_timing', clipId: mainClips(p)[0].id, start: 3 }], ctx)).toThrow(/main-track/);
  });

  it('update_clip merges place and null resets it', () => {
    let p = applyOps(project(), [{ op: 'add_clip', clip: { id: 'g', trackId: 'V2', graphic: 'lib/keys', start: 1, in: 0, out: 3 } }], ctx);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'g', patch: { place: { dx: 0.1 } } }, { op: 'update_clip', clipId: 'g', patch: { place: { scale: 0.8 } } }], ctx);
    expect(p.clips.find((c) => c.id === 'g')?.place).toEqual({ dx: 0.1, dy: 0, scale: 0.8 });
    p = applyOps(p, [{ op: 'update_clip', clipId: 'g', patch: { place: null } }], ctx);
    expect(p.clips.find((c) => c.id === 'g')?.place).toBeUndefined();
  });

  it('clear_suggestions by author, set_style', () => {
    let p = applyOps(project(), [{ op: 'add_suggestions', items: [{ mediaId: 'm1', t0: 1, t1: 2, reason: 'silence', author: 'analysis' }, { mediaId: 'm1', t0: 3, t1: 4, reason: 'other' }] }], ctx);
    p = applyOps(p, [{ op: 'clear_suggestions', author: 'analysis' }], ctx);
    expect(p.suggestions.map((s) => s.author)).toEqual(['claude']);
    p = applyOps(p, [{ op: 'clear_suggestions' }], ctx);
    expect(p.suggestions).toHaveLength(0);

    p = applyOps(p, [{ op: 'set_style', style: 'refs/x/style.json' }], ctx);
    expect(p.style).toBe('refs/x/style.json');
    p = applyOps(p, [{ op: 'set_style', style: null }], ctx);
    expect(p.style).toBeUndefined();
  });
});

describe('notes', () => {
  it('a note follows its moment when the main track is cut, and lands on the next kept moment when its own moment is cut', () => {
    let p = applyOps(project(), [
      { op: 'add_note', note: { id: 'n1', at: 30, text: 'زوم هنا' } },
      { op: 'add_note', note: { id: 'n2', at: 12, end: 18, text: 'احذف هذا الجزء' } },
      { op: 'add_note', note: { id: 'n3', at: 7, text: 'داخل القص' } },
    ], ctx);
    expect(p.notes.map((n) => n.id)).toEqual(['n3', 'n2', 'n1']); // kept in timeline order
    expect(p.notes[0]).toMatchObject({ author: 'user', status: 'open' });
    p = applyOps(p, [{ op: 'cut_range', mediaId: 'm1', t0: 5, t1: 10 }], ctx);
    const by = (id: string) => p.notes.find((n) => n.id === id)!;
    expect(by('n1').at).toBe(25);
    expect([by('n2').at, by('n2').end]).toEqual([7, 13]);
    expect(by('n3').at).toBe(5);
  });

  it('update_note answers and closes a note; delete_note removes it; a range that ends before it starts becomes a point', () => {
    let p = applyOps(project(), [{ op: 'add_note', note: { id: 'n', at: 4, end: 2, text: 'x' } }], ctx);
    expect(p.notes[0].end).toBeUndefined();
    p = applyOps(p, [{ op: 'update_note', id: 'n', patch: { status: 'done', reply: 'زوم 1.15 على اللقطة' } }], ctx);
    expect(p.notes[0]).toMatchObject({ status: 'done', reply: 'زوم 1.15 على اللقطة', text: 'x' });
    expect(() => applyOps(p, [{ op: 'update_note', id: 'nope', patch: {} }], ctx)).toThrow(/not found/);
    expect(applyOps(p, [{ op: 'delete_note', id: 'n' }], ctx).notes).toHaveLength(0);
  });
});

describe('transitions', () => {
  it('set_transition marks how a main clip comes in; new cuts and split tails come in hard; restoring does not merge it away', () => {
    let p = applyOps(project(), [{ op: 'split', clipId: 'c0', at: 30 }], ctx);
    const b = mainClips(p)[1];
    p = applyOps(p, [{ op: 'set_transition', clipIds: [b.id], kind: 'crossfade', duration: 0.8 }], ctx);
    expect(mainClips(p)[1].transition).toEqual({ kind: 'crossfade', duration: 0.8 });
    p = applyOps(p, [{ op: 'set_transition', clipIds: [b.id], kind: 'dip' }], ctx);
    expect(mainClips(p)[1].transition).toEqual({ kind: 'dip', duration: 0.8 }); // keeps its duration

    p = applyOps(p, [{ op: 'cut_range', mediaId: 'm1', t0: 40, t1: 45 }], ctx); // inside the transitioned clip
    expect(mainClips(p).map((c) => c.transition?.kind)).toEqual([undefined, 'dip', undefined]);
    p = applyOps(p, [{ op: 'split', clipId: mainClips(p)[1].id, at: 35 }], ctx);
    expect(mainClips(p).map((c) => c.transition?.kind)).toEqual([undefined, 'dip', undefined, undefined]);

    // restoring the cut rejoins the pieces after the transition, but the transition itself stays
    p = applyOps(p, [{ op: 'restore_range', mediaId: 'm1', t0: 40, t1: 45 }], ctx);
    expect(mainClips(p).find((c) => c.transition)?.in).toBe(30);

    const withTr = mainClips(p).find((c) => c.transition)!;
    expect(applyOps(p, [{ op: 'set_transition', clipIds: [withTr.id], kind: null }], ctx).clips.some((c) => c.transition)).toBe(false);
    const withText = applyOps(p, [{ op: 'add_text', text: 'x', start: 1, duration: 1 }], ctx);
    expect(() => applyOps(withText, [{ op: 'set_transition', clipIds: [withText.clips.find((c) => c.text)!.id], kind: 'dip' }], ctx)).toThrow(/main-track/);
  });
});

describe('styles', () => {
  it('a style sets the theme, replaces the default grade, restyles captions and (optionally) puts its transition on every cut', async () => {
    const { styleOps, STYLE_PRESETS } = await import('../src/styles.ts');
    const { captionOps } = await import('../src/captions.ts');
    const words: Word[] = Array.from({ length: 6 }, (_, i) => ({ i, t0: i, t1: i + 0.6, w: `w${i}` }));
    let p = applyOps(project(), [{ op: 'set_grade', asDefault: true, grade: { lut: 'luts/old.cube' } }, { op: 'split', clipId: 'c0', at: 30 }], ctx);
    p = applyOps(p, captionOps(p, () => ({ mediaId: 'm1', language: 'ar', model: 'x', words, segments: [] })), ctx);
    const poster = STYLE_PRESETS.find((s) => s.id === 'bold-poster')!;
    p = applyOps(p, styleOps(p, poster, { captions: true, transitions: true }), ctx);
    expect(p.settings.theme.accent).toBe('#ffd400');
    expect(p.settings.defaultGrade).toMatchObject({ contrast: 1.12, saturation: 1.1 });
    expect(p.settings.defaultGrade?.lut).toBeUndefined(); // the old look's LUT is gone
    expect(p.clips.filter((c) => c.trackId === 'CAP').every((c) => c.textStyle?.background === '#ffd400' && c.textStyle?.size === 58)).toBe(true);
    expect(mainClips(p).map((c) => c.transition?.kind)).toEqual([undefined, 'flash']);
    // captions made later keep the style
    p = applyOps(p, captionOps(p, () => ({ mediaId: 'm1', language: 'ar', model: 'x', words, segments: [] })), ctx);
    expect(p.clips.find((c) => c.trackId === 'CAP')?.textStyle).toMatchObject({ background: '#ffd400', animation: 'none' });
  });
});

describe('sound effects', () => {
  it('sfxPlan puts effects on graphic entrances, animated titles and lively transitions — not on captions, soft transitions or split tails', async () => {
    const { sfxPlan } = await import('../src/sfx.ts');
    let p = applyOps(project(), [
      { op: 'add_clip', clip: { id: 'g1', trackId: 'V2', graphic: 'lib/keys', start: 5, in: 0, out: 3 } },
      { op: 'add_clip', clip: { id: 'g2', trackId: 'V2', graphic: 'lib/steps', start: 12, in: 0, out: 6 } },
      { op: 'add_text', text: 'عنوان', start: 20, duration: 3, style: { animation: 'pop' } },
      { op: 'add_text', text: 'كابشن', start: 22, duration: 2, trackId: 'T1', style: { animation: 'none' } },
      { op: 'split', clipId: 'c0', at: 45 },
      { op: 'split', clipId: 'c0', at: 30 },
    ], ctx);
    p = applyOps(p, [{ op: 'split', clipId: 'g2', at: 15 }], ctx); // the tail of g2 must stay quiet
    const [, b, c] = mainClips(p);
    p = applyOps(p, [{ op: 'set_transition', clipIds: [b.id], kind: 'slide', duration: 0.4 }, { op: 'set_transition', clipIds: [c.id], kind: 'crossfade' }], ctx);
    const plan = sfxPlan(p);
    expect(plan.map((q) => [q.sfx, q.at])).toEqual([['click', 5], ['whoosh', 12], ['pop', 20], ['swoosh', 29.8]]);
  });

  it('sfxPlan drops the same sound again within a second (step title, then its callout) and spaces against kept cues', async () => {
    const { sfxPlan } = await import('../src/sfx.ts');
    const p = applyOps(project(), [
      { op: 'add_text', text: 'الخطوة ١', start: 4.8, duration: 5, style: { animation: 'slide-up' } },
      { op: 'add_clip', clip: { id: 'k1', trackId: 'V2', graphic: 'lib/callout', start: 5.7, in: 0, out: 4 } }, // pop 0.9 s after the title pop
      { op: 'add_clip', clip: { id: 'k2', trackId: 'V2', graphic: 'lib/keys', start: 6.2, in: 0, out: 2 } }, // a different sound: stays
      { op: 'add_clip', clip: { id: 'k3', trackId: 'V2', graphic: 'lib/callout', start: 8, in: 0, out: 2 } }, // a pop well after: stays
    ], ctx);
    expect(sfxPlan(p).map((q) => [q.sfx, q.at])).toEqual([['pop', 4.8], ['click', 6.2], ['pop', 8]]);
  });
});

describe('speed_range', () => {
  it('speeds up a stretch of the main clip', () => {
    const p = applyOps(project(), [{ op: 'speed_range', mediaId: 'm1', t0: 10, t1: 30, speed: 4 }], ctx);
    expect(mainClips(p).map((c) => [c.start, c.in, c.out, c.speed])).toEqual([[0, 0, 10, 1], [10, 10, 30, 4], [15, 30, 60, 1]]);
  });

  it('a second speed change updates the automatic label, keeps a written one', () => {
    let p = applyOps(project(), [{ op: 'speed_range', mediaId: 'm1', t0: 10, t1: 30, speed: 4 }], ctx);
    p = applyOps(p, [{ op: 'speed_range', mediaId: 'm1', t0: 10, t1: 30, speed: 2 }], ctx);
    expect(mainClips(p)[1].label).toBe('x2');
    const id = mainClips(p)[1].id;
    p = applyOps(p, [{ op: 'update_clip', clipId: id, patch: { label: 'شاشة' } }, { op: 'speed_range', mediaId: 'm1', t0: 10, t1: 30, speed: 3 }], ctx);
    expect(mainClips(p)[1].label).toBe('شاشة');
  });
});

describe('captions', () => {
  it('captions only the words that survive the cut, at their new times', async () => {
    const { captionOps } = await import('../src/captions.ts');
    const words: Word[] = Array.from({ length: 12 }, (_, i) => ({ i, t0: i, t1: i + 0.6, w: `w${i}` }));
    let p = applyOps(project(), [{ op: 'cut_range', mediaId: 'm1', t0: 2.8, t1: 5.8 }], ctx); // drops w3..w5
    p = applyOps(p, captionOps(p, () => ({ mediaId: 'm1', language: 'ar', model: 'x', words, segments: [] })), ctx);
    const caps = p.clips.filter((c) => c.trackId === 'CAP').sort((a, b) => a.start - b.start);
    const all = caps.map((c) => c.text).join(' ');
    expect(all).not.toMatch(/w3|w4|w5/);
    expect(all).toMatch(/w6/);
    const w6 = caps.find((c) => c.text?.includes('w6'))!;
    expect(w6.start).toBeLessThanOrEqual(3.01); // w6 moved from 6s to 3s
    // regenerating replaces, not duplicates
    const again = applyOps(p, captionOps(p, () => ({ mediaId: 'm1', language: 'ar', model: 'x', words, segments: [] })), ctx);
    expect(again.clips.filter((c) => c.trackId === 'CAP')).toHaveLength(caps.length);
  });
});

describe('stills', () => {
  const withImage = () => {
    const p = project();
    p.media.push({ id: 'img', path: 'source/shot.png', role: 'broll', kind: 'image', name: 'shot', duration: 5, width: 1920, height: 1080, fps: 0, hasAudio: false, analyzed: [] });
    return p;
  };
  it('an image clip can be made longer than its default 5 seconds', () => {
    let p = applyOps(withImage(), [{ op: 'add_clip', clip: { id: 'i1', trackId: 'V2', mediaId: 'img', in: 0, out: 5, start: 2 } }], ctx);
    expect(p.clips.find((c) => c.id === 'i1')!.out).toBe(5);
    p = applyOps(p, [{ op: 'trim', clipId: 'i1', out: 12 }, { op: 'set_timing', clipId: 'i1', duration: 9 }], ctx);
    expect(p.clips.find((c) => c.id === 'i1')!.out).toBe(9);
  });
  it('an empty clip is refused', () => {
    expect(() => applyOps(project(), [{ op: 'add_clip', clip: { trackId: 'V2', mediaId: 'm1', in: 4, out: 4 } }], ctx)).toThrow(/empty/);
  });
});

describe('clip picture and sound fades', () => {
  it('merges picture patches (crop side by side), clears with null, and refuses values out of range', () => {
    let p = applyOps(project(), [{ op: 'update_clip', clipId: 'c0', patch: { picture: { rotate: 90, crop: { l: 0.1 } } } }], ctx);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'c0', patch: { picture: { flipX: true, crop: { t: 0.2 } } } }], ctx);
    expect(p.clips[0].picture).toEqual({ fit: 'fill', bars: 'black', rotate: 90, flipX: true, flipY: false, crop: { l: 0.1, t: 0.2, r: 0, b: 0 }, opacity: 1 });
    expect(() => applyOps(p, [{ op: 'update_clip', clipId: 'c0', patch: { picture: { crop: { l: 0.6 } } } }], ctx)).toThrow();
    expect(() => applyOps(p, [{ op: 'update_clip', clipId: 'c0', patch: { picture: { rotate: 400 } } }], ctx)).toThrow();
    expect(applyOps(p, [{ op: 'update_clip', clipId: 'c0', patch: { picture: null } }], ctx).clips[0].picture).toBeUndefined();
  });
  it('stores per-clip fades', () => {
    const p = applyOps(project(), [{ op: 'update_clip', clipId: 'c0', patch: { fadeIn: 1.5, fadeOut: 2 } }], ctx);
    expect(p.clips[0]).toMatchObject({ fadeIn: 1.5, fadeOut: 2 });
    expect(() => OpBatch.parse([{ op: 'update_clip', clipId: 'c0', patch: { fadeIn: -1 } }])).toThrow(); // checked where ops come in
  });
});

describe('freeze, detach audio, replace media', () => {
  const withStill = () => {
    const p = project();
    p.media.push({ id: 'still', path: 'source/a-freeze.png', role: 'source', kind: 'image', name: 'a freeze', duration: 5, width: 1920, height: 1080, fps: 0, hasAudio: false, analyzed: [], derived: { kind: 'freeze', mediaId: 'm1', in: 20, out: 20 } });
    return p;
  };
  it('freeze_frame splits a main clip, holds the frame and pushes the rest (and what sits on it) later', () => {
    let p = applyOps(withStill(), [
      { op: 'update_clip', clipId: 'c0', patch: { transform: { keyframes: [{ t: 10, scale: 1, x: 0.5, y: 0.5 }, { t: 30, scale: 2, x: 0.5, y: 0.5 }] } } },
      { op: 'add_text', text: 'بعد', start: 30, duration: 2 },
    ], ctx);
    p = applyOps(p, [{ op: 'freeze_frame', clipId: 'c0', at: 20, mediaId: 'still', duration: 3 }], ctx);
    const main = mainClips(p);
    expect(main.map((c) => [c.mediaId, c.start, c.in, c.out])).toEqual([['m1', 0, 0, 20], ['still', 20, 0, 3], ['m1', 23, 20, 60]]);
    expect(main[1].label).toBe('تجميد');
    expect(main[1].transform).toMatchObject({ scale: 1.5, keyframes: [] }); // the zoom at that moment, held
    expect(main[2].transform!.keyframes.map((k) => k.t)).toEqual([-10, 10]); // the rest keeps its motion
    expect(p.clips.find((c) => c.text === 'بعد')!.start).toBe(33);
  });
  it('freeze_frame at a clip start goes before it, and on a layer moves the rest of that clip only', () => {
    let p = applyOps(withStill(), [{ op: 'freeze_frame', clipId: 'c0', at: 0, mediaId: 'still', duration: 2 }], ctx);
    expect(mainClips(p).map((c) => [c.mediaId, c.start])).toEqual([['still', 0], ['m1', 2]]);
    p = applyOps(withStill(), [{ op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', in: 5, out: 15, start: 10 } }], ctx);
    p = applyOps(p, [{ op: 'freeze_frame', clipId: 'b', at: 14, mediaId: 'still', duration: 1 }], ctx);
    expect(p.clips.filter((c) => c.trackId === 'V2').sort((a, b) => a.start - b.start).map((c) => [c.mediaId, c.start, c.in, c.out])).toEqual([['m1', 10, 5, 9], ['still', 14, 0, 1], ['m1', 15, 9, 15]]);
    expect(() => applyOps(p, [{ op: 'freeze_frame', clipId: 'c0', at: 3, mediaId: 'm1', duration: 1 }], ctx)).toThrow(/still/);
  });
  it('detach_audio moves the sound to a free audio track with the same timing and silences the clip', () => {
    let p = applyOps(project(), [{ op: 'update_clip', clipId: 'c0', patch: { volume: 1.5, fadeIn: 0.5 } }, { op: 'detach_audio', clipId: 'c0' }], ctx);
    const a = p.clips.find((c) => p.tracks.find((t) => t.id === c.trackId)?.audio === 'voice')!;
    expect(a).toMatchObject({ mediaId: 'm1', start: 0, in: 0, out: 60, volume: 1.5, fadeIn: 0.5, fadeOut: 0 });
    expect(p.clips.find((c) => c.id === 'c0')).toMatchObject({ volume: 0 });
    expect(p.clips.find((c) => c.id === 'c0')!.fadeIn).toBeUndefined();
    expect(() => applyOps(p, [{ op: 'detach_audio', clipId: 'c0' }], ctx)).toThrow(/silent/);
    expect(p.tracks.find((t) => t.id === a.trackId)).toMatchObject({ audio: 'voice' });
    // The voice track is taken now: another clip's sound gets a new one
    p = applyOps(p, [{ op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', in: 0, out: 5, start: 1 } }, { op: 'detach_audio', clipId: 'b' }], ctx);
    expect(p.tracks.find((t) => t.id === 'A4')).toMatchObject({ kind: 'audio', audio: 'voice' });
    expect(p.clips.find((c) => c.trackId === 'A4')).toMatchObject({ start: 1, in: 0, out: 5 });
  });
  it('replace_media swaps what a clip plays, keeping its place and settings', () => {
    let p = applyOps(project(), [{ op: 'add_text', text: 'x', start: 40, duration: 1 }, { op: 'update_clip', clipId: 'c0', patch: { grade: { contrast: 1.2 } } }], ctx);
    p.media.push({ ...p.media[0], id: 'rev', path: 'source/a-rev.mp4', duration: 60, derived: { kind: 'reverse', mediaId: 'm1', in: 0, out: 60 } });
    p = applyOps(p, [{ op: 'replace_media', clipId: 'c0', mediaId: 'rev', in: 0, out: 60 }], ctx);
    expect(p.clips.find((c) => c.id === 'c0')).toMatchObject({ mediaId: 'rev', in: 0, out: 60, grade: { contrast: 1.2 } });
    expect(p.clips.find((c) => c.text === 'x')!.start).toBe(40);
    expect(() => applyOps(p, [{ op: 'replace_media', clipId: 'c0', mediaId: 'rev', in: 0, out: 90 }], ctx)).toThrow(/invalid/);
  });
  it('neighbours with different pictures are not merged back into one clip', () => {
    let p = applyOps(project(), [{ op: 'split', clipId: 'c0', at: 30 }], ctx);
    p = applyOps(p, [{ op: 'update_clip', clipId: mainClips(p)[1].id, patch: { picture: { flipX: true } } }, { op: 'cut_range', mediaId: 'm1', t0: 10, t1: 12 }, { op: 'restore_range', mediaId: 'm1', t0: 10, t1: 12 }], ctx);
    expect(mainClips(p).length).toBe(2);
  });
});

describe('keyframes of place, opacity and volume', () => {
  it('zoom keys ease like the other keys and keep their curve through edits', async () => {
    const { transformAt } = await import('../src/index.ts');
    const kfs = [{ t: 0, scale: 1, x: 0.5, y: 0.5, ease: 'linear' as const }, { t: 2, scale: 2, x: 0.5, y: 0.5 }];
    expect(transformAt({ scale: 1, x: 0.5, y: 0.5, keyframes: kfs }, 0.5).scale).toBeCloseTo(1.25); // linear
    expect(transformAt({ scale: 1, x: 0.5, y: 0.5, keyframes: [{ ...kfs[0], ease: undefined }, kfs[1]] }, 0.5).scale).toBeCloseTo(1.15625); // smoothstep
    expect(transformAt({ scale: 1, x: 0.5, y: 0.5, keyframes: [{ ...kfs[0], ease: 'hold' }, kfs[1]] }, 1.9).scale).toBe(1);
    const p = applyOps(project(), [{ op: 'update_clip', clipId: 'c0', patch: { transform: { keyframes: kfs } } }], ctx);
    expect(p.clips.find((c) => c.id === 'c0')!.transform!.keyframes[0].ease).toBe('linear');
  });

  it('sets, replaces and clears keys per property; values ease between them and hold outside', async () => {
    const { keyAt, placeAt, volumeAt, opacityAt } = await import('../src/index.ts');
    let p = applyOps(project(), [
      { op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', in: 0, out: 10, start: 5, place: { dx: 0, dy: 0, scale: 0.5 } } },
      { op: 'update_clip', clipId: 'b', patch: { anim: { dx: [{ t: 4, v: 0.3 }, { t: 0, v: -0.3 }], opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } } },
    ], ctx);
    const b = () => p.clips.find((c) => c.id === 'b')!;
    expect(b().anim!.dx!.map((k) => k.t)).toEqual([0, 4]); // kept in time order
    expect(placeAt(b(), 2)).toEqual({ dx: 0, dy: 0, scale: 0.5, ax: 0.5, ay: 0.5 }); // halfway, smoothstep; the fixed place under it
    expect(placeAt(b(), 9).dx).toBe(0.3);
    expect(opacityAt(b(), -1)).toBe(0);
    expect(volumeAt(b(), 3)).toBe(1);
    expect(keyAt([{ t: 0, v: 0 }, { t: 2, v: 1 }], 0.5, 9)).toBeCloseTo(0.15625);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: { anim: { dx: null, volume: [{ t: 1, v: 2 }] } } }], ctx);
    expect(Object.keys(b().anim!)).toEqual(['opacity', 'volume']);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: { anim: { opacity: [], volume: null } } }], ctx);
    expect(b().anim).toBeUndefined();
    expect(() => OpBatch.parse([{ op: 'update_clip', clipId: 'b', patch: { anim: { opacity: [{ t: 0, v: 2 }] } } }])).toThrow();
  });
  it('each key eases toward the next by its own curve, the same in the editor and the render', async () => {
    const { keyAt } = await import('../src/index.ts');
    const { keyExpr } = await import('../../render/src/compile.ts');
    const at = (ease: any, t: number) => keyAt([{ t: 0, v: 0, ease }, { t: 2, v: 1 }], t, 0);
    expect(at('linear', 0.5)).toBeCloseTo(0.25);
    expect(at('in', 1)).toBeCloseTo(0.25);
    expect(at('out', 1)).toBeCloseTo(0.75);
    expect(at('hold', 1.99)).toBe(0);
    expect(at('hold', 2)).toBe(1);
    expect(at(undefined, 1)).toBeCloseTo(0.5);
    // the ffmpeg expression gives the same numbers
    const run = (expr: string, t: number) => Function('t', 'clip', 'lt', 'if_', `return ${expr.replace(/if\(/g, 'if_(')}`)(t, (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)), (a: number, b: number) => (a < b ? 1 : 0), (c: number, a: number, b: number) => (c ? a : b));
    for (const ease of ['linear', 'in', 'out', 'hold', undefined] as const) {
      const keys = [{ t: 0, v: 0, ...(ease ? { ease } : {}) }, { t: 2, v: 1 }];
      for (const t of [0.3, 1, 1.7]) expect(run(keyExpr(keys, 0), t)).toBeCloseTo(keyAt(keys, t, 0));
    }
    let p = applyOps(project(), [{ op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', in: 0, out: 10, start: 0 } }], ctx);
    p = applyOps(p, [{ op: 'update_clip', clipId: 'b', patch: { anim: { opacity: [{ t: 1, v: 1 }, { t: 0, v: 0, ease: 'out' }] } } }], ctx);
    expect(p.clips.find((c) => c.id === 'b')!.anim!.opacity).toEqual([{ t: 0, v: 0, ease: 'out' }, { t: 1, v: 1 }]);
  });
  it('voice cleanup is set per clip, 0 turns it off, and the render filters it before the speed change', async () => {
    const { compile, denoiseFilters } = await import('../../render/src/compile.ts');
    let p = applyOps(project(), [{ op: 'update_clip', clipId: project().clips[0].id, patch: { denoise: 0.5 } }], ctx);
    const id = project().clips[0].id;
    expect(p.clips.find((c) => c.id === id)!.denoise).toBe(0.5);
    expect(denoiseFilters(0.5)).toEqual(['highpass=f=75', 'afftdn=nr=18:nf=-35:tn=1']);
    expect(denoiseFilters(0)).toEqual([]);
    p = applyOps(p, [{ op: 'update_clip', clipId: id, patch: { denoise: 0 } }], ctx);
    expect('denoise' in p.clips.find((c) => c.id === id)!).toBe(false);
    expect(compile).toBeTypeOf('function');
  });
  it('a split tail keeps its motion; a freeze holds the place and opacity of that moment', () => {
    let p = applyOps(project(), [
      { op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', in: 0, out: 10, start: 0 } },
      { op: 'update_clip', clipId: 'b', patch: { anim: { scale: [{ t: 0, v: 0.2 }, { t: 10, v: 1 }], opacity: [{ t: 0, v: 1 }, { t: 10, v: 0 }] } } },
    ], ctx);
    p = applyOps(p, [{ op: 'split', clipId: 'b', at: 5 }], ctx);
    const tail = p.clips.find((c) => c.trackId === 'V2' && c.start === 5)!;
    expect(tail.anim!.scale!.map((k) => k.t)).toEqual([-5, 5]);
    p.media.push({ id: 'still', path: 's.png', role: 'source', kind: 'image', name: 's', duration: 5, width: 1920, height: 1080, fps: 0, hasAudio: false, analyzed: [] });
    p = applyOps(p, [{ op: 'freeze_frame', clipId: 'b', at: 5, mediaId: 'still', duration: 1 }], ctx);
    const still = p.clips.find((c) => c.mediaId === 'still')!;
    // at the end of the first half: halfway through both moves
    expect(still.place).toEqual({ dx: 0, dy: 0, scale: 0.6 });
    expect(still.picture!.opacity).toBe(0.5);
    expect(still.anim).toBeUndefined();
  });
});

describe('text style back to the identity', () => {
  it('null clears a text’s own colour, background and font; other fields stay', () => {
    let p = applyOps(project(), [{ op: 'add_text', text: 'x', start: 1, duration: 2, style: { color: '#ff0000', background: '#000000', font: 'Cairo', size: 60 } }], ctx);
    const id = p.clips.find((c) => c.text === 'x')!.id;
    p = applyOps(p, [{ op: 'update_clip', clipId: id, patch: { textStyle: { color: null, background: null, font: null } } }], ctx);
    const st = p.clips.find((c) => c.id === id)!.textStyle!;
    expect(st.color).toBeUndefined();
    expect(st.background).toBeUndefined();
    expect(st.font).toBeUndefined();
    expect(st.size).toBe(60);
  });
});

describe('moving clips between the main track and the others', () => {
  const two = () => applyOps(project(), [
    { op: 'split', clipId: 'c0', at: 20 },
    { op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', in: 0, out: 4, start: 40, place: { dx: 0.3, dy: 0, scale: 0.4 }, anim: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }], dx: [{ t: 0, v: 0.3 }] } } },
    { op: 'add_text', text: 'فوق', start: 30, duration: 2 },
  ], ctx);

  it('off the main track: the clip keeps its time, the main track closes up, free clips stay on their content', () => {
    let p = two();
    const main = mainClips(p);
    const textAt = p.clips.find((c) => c.text === 'فوق')!.start;
    p = applyOps(p, [{ op: 'set_transition', clipIds: [main[0].id], kind: 'crossfade' }, { op: 'move', clipId: main[0].id, trackId: 'V2', start: 5 }], ctx);
    const moved = p.clips.find((c) => c.id === main[0].id)!;
    expect(moved).toMatchObject({ trackId: 'V2', start: 5 });
    expect(moved.transition).toBeUndefined();
    expect(mainClips(p).map((c) => c.start)).toEqual([0]); // the rest packed to 0
    expect(p.clips.find((c) => c.text === 'فوق')!.start).toBe(textAt - 20); // its words moved 20s earlier
  });

  it('onto the main track: joins at the index, full frame (no place), opacity keys kept', () => {
    let p = two();
    p = applyOps(p, [{ op: 'move', clipId: 'b', trackId: 'V1', index: 1 }], ctx);
    const main = mainClips(p);
    expect(main.map((c) => c.id)[1]).toBe('b');
    expect(main.map((c) => c.start)).toEqual([0, 20, 24]);
    const b = p.clips.find((c) => c.id === 'b')!;
    expect(b.place).toBeUndefined();
    expect(b.anim).toEqual({ opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }] });
  });

  it('refuses tracks that do not fit the clip', () => {
    const p = two();
    const text = p.clips.find((c) => c.text === 'فوق')!.id;
    expect(() => applyOps(p, [{ op: 'move', clipId: text, trackId: 'V1' }], ctx)).toThrow(/main track/);
    expect(() => applyOps(p, [{ op: 'move', clipId: text, trackId: 'A2' }], ctx)).toThrow(/can't go/);
    expect(applyOps(p, [{ op: 'move', clipId: 'b', trackId: 'A2' }], ctx).clips.find((c) => c.id === 'b')?.trackId).toBe('A2');
  });
});
