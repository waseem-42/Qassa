import { clipDuration, type Anim, type Clip, type GraphicEdit } from '@edit/shared';

// Hand edits of the elements inside a graphic page, and the entrance / exit presets of a layer.

/** The clip's edit list with `patch` merged into the edit of `target`; an edit left with nothing to do is dropped. */
export function withEdit(list: GraphicEdit[] | undefined, target: string, patch: Partial<GraphicEdit> | null): GraphicEdit[] {
  const rest = (list ?? []).filter((e) => e.target !== target);
  if (!patch) return rest;
  const merged: Record<string, unknown> = { ...(list ?? []).find((e) => e.target === target), ...patch, target };
  for (const [k, v] of Object.entries(merged)) if (v === undefined || v === '' || v === false || (k === 'scale' && v === 1) || ((k === 'dx' || k === 'dy') && v === 0)) delete merged[k];
  const does = Object.keys(merged).some((k) => k !== 'target' && k !== 'label');
  return does ? [...rest, merged as GraphicEdit] : rest;
}

/** The iframe of a graphic clip on the preview (same origin: its document can be read). */
export function graphicFrame(clipId: string): HTMLIFrameElement | null {
  return document.querySelector(`iframe[data-graphic-clip="${CSS.escape(clipId)}"]`);
}

/** The element an edit points at, in the graphic's page on the preview. */
export function graphicElement(clipId: string, target: string): Element | null {
  try { return graphicFrame(clipId)?.contentDocument?.querySelector(target) ?? null; } catch { return null; }
}

export type Motion = 'none' | 'fade' | 'slide' | 'zoom' | 'pop';
export const MOTIONS: Record<Motion, string> = { none: 'بدون', fade: 'ظهور', slide: 'انزلاق', zoom: 'زوم', pop: 'نطّة' };
const MOTION_PROPS = ['dx', 'dy', 'scale', 'opacity'] as const;

type Keys = Partial<Record<(typeof MOTION_PROPS)[number], { t: number; v: number }[]>>;

/** Keys over [t0, t1]: an entrance goes from "off" to the rest place, an exit from the rest place to "off". */
function side(m: Motion, t0: number, t1: number, enter: boolean, base: { dx: number; dy: number; scale: number; opacity: number }): Keys {
  const k = (u: number, v: number) => ({ t: Math.round((t0 + u * (t1 - t0)) * 1000) / 1000, v });
  const pair = (off: number, rest: number) => (enter ? [k(0, off), k(1, rest)] : [k(0, rest), k(1, off)]);
  switch (m) {
    case 'fade': return { opacity: pair(0, base.opacity) };
    case 'slide': return { opacity: pair(0, base.opacity), dy: pair(base.dy + 0.06, base.dy) };
    case 'zoom': return { opacity: pair(0, base.opacity), scale: pair(base.scale * 0.85, base.scale) };
    case 'pop': return enter
      ? { opacity: [k(0, 0), k(0.4, base.opacity)], scale: [k(0, base.scale * 0.6), k(0.7, base.scale * 1.06), k(1, base.scale)] }
      : { opacity: [k(0.6, base.opacity), k(1, 0)], scale: [k(0, base.scale), k(0.3, base.scale * 1.06), k(1, base.scale * 0.6)] };
    default: return {};
  }
}

/** The anim patch for an entrance and an exit (each `len` seconds); properties neither uses are cleared. */
export function motionPatch(c: Clip, enter: Motion, exit: Motion, len = 0.4): NonNullable<Anim> & Record<string, unknown> {
  const D = clipDuration(c);
  const l = Math.min(len, D / 3);
  const base = { dx: c.place?.dx ?? 0, dy: c.place?.dy ?? 0, scale: c.place?.scale ?? 1, opacity: c.picture?.opacity ?? 1 };
  const a = side(enter, 0, l, true, base), b = side(exit, D - l, D, false, base);
  const out: Record<string, unknown> = {};
  for (const p of MOTION_PROPS) {
    const keys = [...(a[p] ?? []), ...(b[p] ?? [])];
    out[p] = keys.length ? keys : null;
  }
  return out as NonNullable<Anim> & Record<string, unknown>;
}

/** Which preset pair the clip's keys are, if any (so the buttons can show it). */
export function currentMotion(c: Clip): { enter?: Motion; exit?: Motion } {
  const norm = (v: unknown) => JSON.stringify(v ?? null);
  const names = Object.keys(MOTIONS) as Motion[];
  for (const enter of names) for (const exit of names) {
    const p = motionPatch(c, enter, exit);
    if (MOTION_PROPS.every((k) => norm(p[k]) === norm(c.anim?.[k]))) return { enter, exit };
  }
  return {};
}
