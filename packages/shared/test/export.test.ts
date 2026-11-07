import { describe, expect, it } from 'vitest';
import { applyOps, captionsSrt, defaultTracks, exportBaseName, exportRange, Project } from '../src/index.ts';

const project = () => applyOps(Project.parse({
  name: 'p', createdAt: '2026-10-29', tracks: defaultTracks(),
  media: [{ id: 'm', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 20 }],
  clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 20 }],
}), [
  { op: 'add_track', track: { id: 'CAP', kind: 'text', name: 'كابشن' } },
  { op: 'add_text', trackId: 'CAP', text: 'السطر الأول', start: 1, duration: 2 },
  { op: 'add_text', trackId: 'CAP', text: 'الثاني', start: 4.5, duration: 1.25 },
  { op: 'add_text', trackId: 'T1', text: 'عنوان ليس كابشن', start: 0, duration: 3 },
]);

describe('export settings', () => {
  it('clamps the range to the edit and refuses an empty one', () => {
    const p = project();
    expect(exportRange(p, {})).toEqual([0, 20]);
    expect(exportRange(p, { range: [5, 99] })).toEqual([5, 20]);
    expect(exportRange(p, { range: [25, 30] })).toBeNull();
    expect(exportRange(p, { range: [3, 3.05] })).toBeNull();
  });

  it('writes the caption track as SRT, timed from the range start and cut to it', () => {
    const p = project();
    expect(captionsSrt(p, [0, 20])).toBe('1\n00:00:01,000 --> 00:00:03,000\nالسطر الأول\n\n2\n00:00:04,500 --> 00:00:05,750\nالثاني\n');
    expect(captionsSrt(p, [2, 5])).toBe('1\n00:00:00,000 --> 00:00:01,000\nالسطر الأول\n\n2\n00:00:02,500 --> 00:00:03,000\nالثاني\n');
    expect(captionsSrt(p, [10, 20])).toBe('');
  });

  it('makes a typed name safe for Windows', () => {
    expect(exportBaseName('قصتي: الجزء/2?', 'p')).toBe('قصتي الجزء 2');
    expect(exportBaseName('  ...  ', 'مشروع')).toBe('مشروع');
    expect(exportBaseName('nul', 'p')).toBe('nul-export');
    expect(exportBaseName('name. ', 'p')).toBe('name');
  });
});
