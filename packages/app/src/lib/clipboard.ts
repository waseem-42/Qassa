import { applyOps, clipDuration, clipEnd, freeTrackFor, mainClips, makeId, MAIN_TRACK, timelineToSource, type Clip, type Op, type Project } from '@edit/shared';

// Copy, paste and duplicate whole clips (Ctrl+C / Ctrl+V / Ctrl+D). Pasted clips get new ids, chosen here so the
// editor can select them; they come in hard (no transition) like any newly placed clip.

const copyOf = (c: Clip, extra: Partial<Clip>): Op => {
  const { id: _id, transition: _t, ...rest } = structuredClone(c);
  return { op: 'add_clip', clip: { ...rest, ...extra, id: makeId('c') } };
};
const idOf = (o: Op) => (o as Extract<Op, { op: 'add_clip' }>).clip.id!;

/**
 * Paste at timeline time `at`: clips off the main track keep their tracks and spacing, the first one at `at`;
 * main-track clips go in at the cut nearest `at` (after the clip under it once past its middle), in order.
 */
export function pasteOps(p: Project, clips: Clip[], at: number): { ops: Op[]; ids: string[] } {
  const ops: Op[] = [];
  // main-track clips first (they move what comes after), then the layers land at the playhead as it is then
  const main = clips.filter((c) => c.trackId === MAIN_TRACK).sort((a, b) => a.start - b.start);
  if (main.length) {
    const order = mainClips(p), hit = timelineToSource(p, at)?.clip;
    const index = hit ? order.indexOf(hit) + (at - hit.start > clipDuration(hit) / 2 ? 1 : 0) : order.length;
    main.forEach((c, i) => ops.push({ ...copyOf(c, {}), index: index + i } as Op));
  }
  const free = clips.filter((c) => c.trackId !== MAIN_TRACK && p.tracks.some((t) => t.id === c.trackId));
  const base = Math.min(...free.map((c) => c.start));
  for (const c of [...free].sort((a, b) => a.start - b.start)) {
    const start = Math.round((at + c.start - base) * 1000) / 1000;
    const plan = freeTrackFor(applyOps(p, ops), c, start, start + clipDuration(c), c.trackId);
    ops.push(...plan.ops, copyOf(c, { start, trackId: plan.track.id }));
  }
  return { ops, ids: ops.filter((o) => o.op === 'add_clip').map(idOf) };
}

/** A copy right after each clip: on the main track the next place in order, elsewhere starting where it ends. */
export function duplicateOps(p: Project, ids: string[]): { ops: Op[]; ids: string[] } {
  const ops: Op[] = [];
  const order = mainClips(p);
  const picked = p.clips.filter((c) => ids.includes(c.id)).sort((a, b) => a.start - b.start);
  let shift = 0; // main-track copies already put in before this one
  for (const c of picked) {
    if (c.trackId === MAIN_TRACK) ops.push({ ...copyOf(c, {}), index: order.indexOf(c) + 1 + shift++ } as Op);
    else {
      const start = Math.round(clipEnd(c) * 1000) / 1000;
      const plan = freeTrackFor(applyOps(p, ops), c, start, start + clipDuration(c), c.trackId);
      ops.push(...plan.ops, copyOf(c, { start, trackId: plan.track.id }));
    }
  }
  return { ops, ids: ops.filter((o) => o.op === 'add_clip').map(idOf) };
}
