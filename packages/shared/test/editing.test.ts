import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, editingPlan, mainDuration, OpBatch, Project, type Transcript } from '../src/index.ts';

function fixture() {
  return Project.parse({ name: 'editing', createdAt: '2026-01-01', tracks: defaultTracks(),
    media: [{ id: 'm', name: 'source', path: 'source/a.mp4', kind: 'video', role: 'source', duration: 20, hasAudio: true }, { id: 'b', name: 'broll', path: 'source/b.mp4', kind: 'video', role: 'broll', duration: 2 }],
    clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', in: 0, out: 20, start: 0 }],
  });
}
const transcript: Transcript = { mediaId: 'm', language: 'ar', model: 'test', segments: [], words: Array.from({ length: 10 }, (_, i) => ({ i, t0: i, t1: i + 0.5, w: 'شرح' })) };

describe('editing recipes', () => {
  it('generates valid atomic operations, motion, titles, captions and muted broll without changing source duration', () => {
    const p = fixture();
    const plan = editingPlan(p, 'punchy', { motion: true, captions: true, title: 'عنوان', broll: true }, () => transcript);
    OpBatch.parse(plan.ops);
    const result = applyOps(p, plan.ops);
    expect(mainDuration(result)).toBe(20);
    expect(result.clips.find((c) => c.id === 'c')?.transform?.keyframes.length).toBeGreaterThan(2);
    expect(result.clips.filter((c) => c.trackId === 'CAP').length).toBeGreaterThan(0);
    expect(result.clips.find((c) => c.mediaId === 'b')).toMatchObject({ volume: 0, out: 2, trackId: 'EDIT_STYLE' });
    expect(p.clips).toHaveLength(1);
  });
  it('preserves existing transforms and captions when transcripts are incomplete', () => {
    const p = applyOps(fixture(), [{ op: 'update_clip', clipId: 'c', patch: { transform: { scale: 1.4 } } }, { op: 'add_text', trackId: 'T1', text: 'keep', duration: 2, start: 1 }]);
    const plan = editingPlan(p, 'explain', { motion: true, captions: true }, () => undefined);
    expect(plan.ops).toEqual([]);
    expect(plan.warnings).toHaveLength(2);
  });
  it('reapplying owned overlays replaces them without duplicating or deleting user tracks', () => {
    let p = applyOps(fixture(), [{ op: 'add_text', text: 'user', start: 0, duration: 3 }]);
    for (let i = 0; i < 2; i++) p = applyOps(p, editingPlan(p, 'explain', { title: 'title', broll: true }, () => transcript).ops);
    expect(p.clips.filter((c) => c.trackId === 'EDIT_STYLE')).toHaveLength(2);
    expect(p.clips.some((c) => c.text === 'user')).toBe(true);
  });
  it('does not clear an existing overlay track when no broll is available', () => {
    const p = fixture(); p.media = p.media.filter((m) => m.role !== 'broll');
    expect(editingPlan(p, 'documentary', { broll: true }, () => undefined).ops).toEqual([]);
  });
  it('rejects unknown recipes and empty timelines', () => {
    expect(() => editingPlan(fixture(), 'unknown', {}, () => undefined)).toThrow();
    const p = fixture(); p.clips = [];
    expect(() => editingPlan(p, 'explain', {}, () => undefined)).toThrow();
  });
});
