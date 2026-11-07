import { clipEnd, type Project } from '@edit/shared';

// The magnet: dragged things catch on nearby edges. On the timeline a clip's start or end catches
// on the playhead, other clips' edges and comments; on the preview a layer's edges or centre catch
// on the frame's edges, centre and thirds. Both return what they caught so the UI can draw a guide.

/** Timeline times a drag can catch on. Omit playhead when dragging it; `except` omits a clip's own edges. */
export function timelineTargets(p: Project, playhead?: number, except?: string): number[] {
  const s = new Set<number>([0]);
  if (playhead !== undefined) s.add(playhead);
  for (const c of p.clips) if (c.id !== except) { s.add(c.start); s.add(clipEnd(c)); }
  for (const n of p.notes) { s.add(n.at); if (n.end !== undefined) s.add(n.end); }
  return [...s];
}

/** The nearest target within `tol` seconds, or none. */
export function snapTime(t: number, targets: number[], tol: number): { t: number; at?: number } {
  let best: number | undefined, bd = tol;
  for (const v of targets) { const d = Math.abs(v - t); if (d <= bd) { bd = d; best = v; } }
  return best === undefined ? { t } : { t: best, at: best };
}

/** A clip of length `dur` dropped at `start`: whichever of its two edges is closer to a target wins. */
export function snapSpan(start: number, dur: number, targets: number[], tol: number): { start: number; at?: number } {
  const a = snapTime(start, targets, tol), b = snapTime(start + dur, targets, tol);
  const da = a.at === undefined ? Infinity : Math.abs(a.at - start), db = b.at === undefined ? Infinity : Math.abs(b.at - start - dur);
  if (da === Infinity && db === Infinity) return { start };
  return da <= db ? { start: a.t, at: a.at } : { start: b.t - dur, at: b.at };
}

/** Frame guides as fractions of the frame: edges, centre, thirds. */
export const FRAME_GUIDES = [0, 1 / 3, 0.5, 2 / 3, 1];

/**
 * A box moved on the preview (all in px of the fitted frame). Its left edge, centre or right edge
 * catches on a vertical guide, and likewise vertically. Returns the corrected offset and the guides hit.
 */
export function snapBox(box: { left: number; top: number; width: number; height: number }, fw: number, fh: number, tol: number): { dx: number; dy: number; gx?: number; gy?: number } {
  const axis = (pos: number, size: number, frame: number) => {
    let best: { d: number; guide: number } | undefined;
    for (const g of FRAME_GUIDES.map((f) => f * frame)) {
      for (const edge of [pos, pos + size / 2, pos + size]) {
        const d = g - edge;
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, guide: g };
      }
    }
    return best;
  };
  const x = axis(box.left, box.width, fw), y = axis(box.top, box.height, fh);
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, gx: x?.guide, gy: y?.guide };
}
