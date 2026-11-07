import { expect, it } from 'vitest';
import { applyOps, defaultTracks, Project } from '@edit/shared';
import { titlePlan } from '../src/lib/title.ts';

const project = (duration = 0) => Project.parse({ name: 'titles', createdAt: '', tracks: defaultTracks(), clips: duration ? [{ id: 'v', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: duration }] : [] });

it('clamps new titles to remaining content, with a one-second minimum and four-second empty default', () => {
  for (const [end, start, duration] of [[3, 0, 3], [10, 2, 4], [3, 2.5, 1], [0, 0, 4], [3, 3, 4], [3, 4, 4]]) {
    const p = project(end), plan = titlePlan(p, start);
    const added = applyOps(p, plan.ops).clips.find((c) => c.id === plan.id)!;
    expect(added.start).toBe(start);
    expect(added.out - added.in).toBe(duration);
    expect(added.textStyle?.animation).toBe('slide-up');
  }
});

it('places titles on an available text layer without overlapping or editing a locked layer', () => {
  let p = project(3);
  const first = titlePlan(p, 0);
  p = applyOps(p, first.ops);
  const second = titlePlan(p, 0);
  const next = applyOps(p, second.ops);
  const a = next.clips.find((c) => c.id === first.id)!, b = next.clips.find((c) => c.id === second.id)!;
  expect(b.trackId).not.toBe(a.trackId);
  expect(b.textStyle).toEqual(a.textStyle);
  const locked = applyOps(project(), [{ op: 'set_track', trackId: 'T1', patch: { locked: true } }]);
  const plan = titlePlan(locked, 0);
  expect(applyOps(locked, plan.ops).clips.find((c) => c.id === plan.id)?.trackId).not.toBe('T1');
});
