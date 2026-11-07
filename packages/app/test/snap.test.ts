import { describe, expect, it } from 'vitest';
import { defaultTracks, Project } from '@edit/shared';
import { snapBox, snapSpan, snapTime, timelineTargets } from '../src/lib/snap.ts';

const project = Project.parse({
  name: 'p', createdAt: '2026-10-29', tracks: defaultTracks(),
  media: [{ id: 'm', path: 'a.mp4', role: 'source', kind: 'video', name: 'a', duration: 30 }],
  clips: [
    { id: 'v', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 10 },
    { id: 't', trackId: 'T1', start: 3, in: 0, out: 2, text: 'x' },
  ],
  notes: [{ id: 'n', at: 7.5, text: 'هنا' }],
});

describe('timeline magnet', () => {
  it('collects the playhead, clip edges and comments, without the dragged clip', () => {
    expect(timelineTargets(project, 4.2).sort((a, b) => a - b)).toEqual([0, 3, 4.2, 5, 7.5, 10]);
    expect(timelineTargets(project, 4.2, 't')).not.toContain(5);
  });
  it('lets the playhead snap to fixed clip cuts without snapping to its own moving position', () => {
    const points = timelineTargets(project);
    expect(points.sort((a, b) => a - b)).toEqual([0, 3, 5, 7.5, 10]);
    expect(snapTime(4.25, points, .2)).toEqual({ t: 4.25 });
    expect(snapTime(9.9, points, .2)).toEqual({ t: 10, at: 10 });
  });
  it('catches the nearest target within the tolerance only', () => {
    expect(snapTime(9.93, [0, 10], 0.1)).toEqual({ t: 10, at: 10 });
    expect(snapTime(9.5, [0, 10], 0.1)).toEqual({ t: 9.5 });
  });
  it('a moved clip catches on whichever edge is nearer', () => {
    expect(snapSpan(7.95, 2, [0, 10], 0.1)).toEqual({ start: 8, at: 10 }); // its end meets 10
    expect(snapSpan(0.04, 2, [0, 10], 0.1)).toEqual({ start: 0, at: 0 }); // its start meets 0
    expect(snapSpan(5, 2, [0, 10], 0.1)).toEqual({ start: 5 });
  });
});

describe('preview magnet', () => {
  it('centres a box on the frame and reports the guide', () => {
    const r = snapBox({ left: 447, top: 100, width: 100, height: 40 }, 1000, 600, 6);
    expect(r).toMatchObject({ dx: 3, gx: 500 }); // its centre 497 → 500
    expect(r.gy).toBeUndefined();
  });
  it('catches edges on the frame edges and thirds', () => {
    expect(snapBox({ left: -4, top: 196, width: 50, height: 50 }, 900, 600, 6)).toMatchObject({ dx: 4, gx: 0, dy: 4, gy: 200 });
  });
});
