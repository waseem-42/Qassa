import { MAIN_TRACK, type AnimProp, type Clip, type Ease, type Key, type Project, type Transform, type Word } from './schema.ts';

export const EPS = 0.002;

export const clipDuration = (c: Clip) => (c.out - c.in) / c.speed;
export const clipEnd = (c: Clip) => c.start + clipDuration(c);

export function trackClips(p: Project, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export const mainClips = (p: Project) => trackClips(p, MAIN_TRACK);

/** Half of the transition from `prev` into `c`, on either side of their cut (0 = hard cut). Never more than ~half of either clip. */
export function transitionHalf(prev: Clip | undefined, c: Clip): number {
  return prev && c.transition && !prev.gap && !c.gap ? Math.min(c.transition.duration / 2, clipDuration(prev) * 0.45, clipDuration(c) * 0.45) : 0;
}

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** The user's timeline marks, independent of source anchors and story edits. */
export function markedRange(p: Project): [number, number] | undefined {
  const { in: from, out: to } = p.settings.marks;
  return from !== undefined && to !== undefined ? [Math.min(from, to), Math.max(from, to)] : undefined;
}

export function mainDuration(p: Project): number {
  return mainClips(p).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Timeline time -> the main-track clip under it and the matching source time. */
export function timelineToSource(p: Project, t: number): { clip: Clip; src: number } | null {
  const clips = mainClips(p);
  for (const c of clips) {
    if (t >= c.start - EPS && t < clipEnd(c) - EPS / 2) return { clip: c, src: c.in + (t - c.start) * c.speed };
  }
  return null;
}

/** Source time of a media -> timeline time, or null when that moment is cut. */
export function sourceToTimeline(p: Project, mediaId: string, src: number, preferClipId?: string): number | null {
  const hits = mainClips(p).filter((c) => c.mediaId === mediaId && src >= c.in - EPS && src < c.out + EPS / 2);
  if (!hits.length) return null;
  const c = hits.find((h) => h.id === preferClipId) ?? hits[0];
  return c.start + (Math.max(src, c.in) - c.in) / c.speed;
}

/** Merged source ranges of a media that survive on the main track. */
export function keptRanges(p: Project, mediaId: string): [number, number][] {
  const r = mainClips(p)
    .filter((c) => c.mediaId === mediaId)
    .map((c) => [c.in, c.out] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of r) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function isKept(ranges: [number, number][], t0: number, t1: number): boolean {
  const mid = (t0 + t1) / 2;
  return ranges.some(([a, b]) => mid >= a && mid <= b);
}

export type WordState = 'keep' | 'cut' | 'suggested';

export function wordStates(p: Project, mediaId: string, words: Word[]): WordState[] {
  const kept = keptRanges(p, mediaId);
  const sugg = p.suggestions.filter((s) => s.mediaId === mediaId);
  return words.map((w) => {
    if (!isKept(kept, w.t0, w.t1)) return 'cut';
    const mid = (w.t0 + w.t1) / 2;
    return sugg.some((s) => mid >= s.t0 && mid <= s.t1) ? 'suggested' : 'keep';
  });
}

/** Timeline times where one main-track clip ends and the next begins. */
export function cutPoints(p: Project): number[] {
  const clips = mainClips(p);
  return clips.slice(1).map((c) => c.start);
}

export function fmtTime(t: number, frac = 1): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(frac).padStart(frac ? 3 + frac : 2, '0')}`;
}

/** Zoom/focus at a time relative to the clip start — eased by the earlier key's ease (smoothstep by default), as the renderer does. */
export function transformAt(tr: Transform | undefined, t: number): { scale: number; x: number; y: number } {
  if (!tr) return { scale: 1, x: 0.5, y: 0.5 };
  const k = [...(tr.keyframes ?? [])].sort((a, b) => a.t - b.t);
  if (!k.length) return { scale: tr.scale, x: tr.x, y: tr.y };
  if (t <= k[0].t) return { scale: k[0].scale, x: k[0].x, y: k[0].y };
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t < b.t) {
      const u = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-3, b.t - a.t)));
      const e = ease(a.ease, u);
      return { scale: a.scale + (b.scale - a.scale) * e, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
    }
  }
  const z = k[k.length - 1];
  return { scale: z.scale, x: z.x, y: z.y };
}

/** Eased progress (0..1) of u (0..1) — the renderer's easeExpr is the same curve. */
export function ease(e: Ease | undefined, u: number): number {
  switch (e) {
    case 'linear': return u;
    case 'in': return u * u;
    case 'out': return u * (2 - u);
    case 'hold': return u >= 1 ? 1 : 0;
    default: return u * u * (3 - 2 * u);
  }
}

/** A keyed value at time t (seconds from the clip start): held before the first key and after the last, eased between by the earlier key's ease (smoothstep by default). */
export function keyAt(keys: Key[] | undefined, t: number, base: number): number {
  if (!keys?.length) return base;
  const k = keys.length > 1 ? [...keys].sort((a, b) => a.t - b.t) : keys;
  if (t <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (t < b.t) {
      const u = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-3, b.t - a.t)));
      return a.v + (b.v - a.v) * ease(a.ease, u);
    }
  }
  return k[k.length - 1].v;
}

/** A layer's place at time t of the clip (its keyframes over its fixed place). */
export function placeAt(c: Pick<Clip, 'place' | 'anim'>, t: number): { dx: number; dy: number; scale: number; ax: number; ay: number } {
  const pl = c.place, a = c.anim;
  return { dx: keyAt(a?.dx, t, pl?.dx ?? 0), dy: keyAt(a?.dy, t, pl?.dy ?? 0), scale: keyAt(a?.scale, t, pl?.scale ?? 1), ax: pl?.ax ?? 0.5, ay: pl?.ay ?? 0.5 };
}

/**
 * Scaling about the anchor instead of the centre is the same as scaling about the centre and shifting by
 * (anchor − ½)·(1 − scale): the shift the picture really has (frame widths / heights). Every drawer uses this.
 */
export function anchoredShift(pl: { dx?: number; dy?: number; scale?: number; ax?: number; ay?: number }): { x: number; y: number } {
  const s = pl.scale ?? 1;
  return { x: (pl.dx ?? 0) + ((pl.ax ?? 0.5) - 0.5) * (1 - s), y: (pl.dy ?? 0) + ((pl.ay ?? 0.5) - 0.5) * (1 - s) };
}
export const opacityAt = (c: Pick<Clip, 'picture' | 'anim'>, t: number) => keyAt(c.anim?.opacity, t, c.picture?.opacity ?? 1);
export const volumeAt = (c: Pick<Clip, 'volume' | 'anim'>, t: number) => keyAt(c.anim?.volume, t, c.volume);
/** The value of a keyable property at time t of the clip. */
export function animValue(c: Clip, prop: AnimProp, t: number): number {
  return prop === 'opacity' ? opacityAt(c, t) : prop === 'volume' ? volumeAt(c, t) : placeAt(c, t)[prop];
}

/** Clips of a track that cover timeline time t. */
export function clipsAt(p: Project, t: number, trackId?: string): Clip[] {
  return p.clips.filter((c) => (!trackId || c.trackId === trackId) && t >= c.start && t < clipEnd(c));
}
