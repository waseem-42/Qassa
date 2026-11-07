import { Clip, freeTrackFor, makeId, projectDuration, type Op, type Project } from '@edit/shared';

/** All title entry points use the same duration, style and free text layer. */
export function titlePlan(project: Project, start: number) {
  const remaining = projectDuration(project) - start;
  const duration = remaining > 0 ? Math.max(1, Math.min(4, remaining)) : 4;
  const clip = Clip.parse({ id: makeId('t'), trackId: 'text', start, in: 0, out: duration, text: 'نص جديد', textStyle: { preset: 'lower-third', x: 0.92, y: 0.84, align: 'start', size: 54, animation: 'slide-up' } });
  const plan = freeTrackFor(project, clip, start, start + duration);
  const ops: Op[] = [...plan.ops, { op: 'add_clip', clip: { ...clip, trackId: plan.track.id } }];
  return { id: clip.id, ops };
}
