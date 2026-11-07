import { clipEnd, MAIN_TRACK, timelineToSource, type Op, type Project } from '@edit/shared';

const EPS = 1e-3;

/**
 * Trim to the playhead (Q / W, like "delete left / right" in other editors): the selected clips under the
 * playhead, else the main-track clip there, lose everything before (start) or after (end) the playhead.
 * Main-track trims ripple; free clips keep their place. Returns null when nothing is under the playhead.
 * `seek` is where the playhead belongs afterwards (the main track closed up behind it).
 */
export function trimToPlayhead(p: Project, selected: string[], time: number, side: 'start' | 'end'): { ops: Op[]; seek?: number } | null {
  const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
  const under = (c: Project['clips'][number]) => time > c.start + EPS && time < clipEnd(c) - EPS && !locked.has(c.trackId);
  let targets = p.clips.filter((c) => selected.includes(c.id) && under(c));
  if (!targets.length) {
    const main = timelineToSource(p, time)?.clip;
    if (main && under(main)) targets = [main];
  }
  if (!targets.length) return null;
  // free clips first: a main-track ripple afterwards carries them along with their content
  targets.sort((a, b) => Number(a.trackId === MAIN_TRACK) - Number(b.trackId === MAIN_TRACK));
  const ops: Op[] = [];
  let seek: number | undefined;
  for (const c of targets) {
    const src = Math.round((c.in + (time - c.start) * c.speed) * 1000) / 1000;
    ops.push(side === 'start' ? { op: 'trim', clipId: c.id, in: src } : { op: 'trim', clipId: c.id, out: src });
    if (side === 'start' && c.trackId === MAIN_TRACK) seek = c.start;
  }
  return { ops, seek };
}
