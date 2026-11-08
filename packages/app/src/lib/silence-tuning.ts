import type { Op, Suggestion } from '@edit/shared';

// Silence cuts tuned by the viewer, like the "minimum silence" and "padding" knobs of auto-cut tools:
// silences shorter than `min` stay, and `pad` seconds of each silence edge stay as breathing room.

/** speed: 0 = silences are cut; above 1 = they stay, played that much faster (no jump cut) */
export interface SilenceTuning { min: number; pad: number; speed?: number }
export const DEFAULT_TUNING: SilenceTuning = { min: 0, pad: 0 };
export const SILENCE_SPEED = 4;
const KEY = 'qassa.silence-tuning';

export function readTuning(): SilenceTuning {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    const min = Number(v.min), pad = Number(v.pad), speed = Number(v.speed);
    return {
      min: Number.isFinite(min) ? Math.max(0, Math.min(3, min)) : 0, pad: Number.isFinite(pad) ? Math.max(0, Math.min(0.5, pad)) : 0,
      ...(speed > 1 && speed <= 16 ? { speed } : {}),
    };
  } catch { return DEFAULT_TUNING; }
}
export function saveTuning(t: SilenceTuning) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* this session only */ }
}

/** Is this suggestion left alone by the tuning (a silence too short to cut once padded)? */
export function tooShort(s: Suggestion, t: SilenceTuning): boolean {
  if (s.reason !== 'silence') return false;
  return s.t1 - s.t0 < t.min - 1e-6 || s.t1 - s.t0 - 2 * t.pad < 0.05;
}

/** The ranges that will actually be cut: silences shrunk by the padding; other reasons as they are. */
export function tunedRanges(list: Suggestion[], t: SilenceTuning): Suggestion[] {
  return list.filter((s) => !tooShort(s, t)).map((s) => (s.reason === 'silence' && t.pad > 0 ? { ...s, t0: s.t0 + t.pad, t1: s.t1 - t.pad } : s));
}

/**
 * One undo step for the picked suggestions. Silences the tuning leaves alone stay as suggestions (a lower
 * threshold can still cut them). Without padding it is the plain accept; with padding the shrunk ranges are
 * cut directly and their suggestions cleared.
 */
export function acceptOps(picked: Suggestion[], t: SilenceTuning): Op[] {
  const cut = tunedRanges(picked, t);
  if (!cut.length) return [];
  const ids = cut.map((s) => s.id);
  const fast = (s: Suggestion) => !!t.speed && s.reason === 'silence';
  if (t.pad === 0 && !cut.some(fast)) return [{ op: 'resolve_suggestions', ids, accept: true }];
  // later ranges first, so each edit leaves the source times of the next one where they were
  const ops: Op[] = [...cut].sort((a, b) => b.t0 - a.t0).map((s): Op => (fast(s)
    ? { op: 'speed_range', mediaId: s.mediaId, t0: s.t0, t1: s.t1, speed: t.speed! }
    : { op: 'cut_range', mediaId: s.mediaId, t0: s.t0, t1: s.t1 }));
  ops.push({ op: 'resolve_suggestions', ids, accept: false });
  return ops;
}

/** Seconds the tuned edit saves: cut ranges in full, sped-up silences all but 1/speed of their length. */
export function tunedSavings(save: (list: Suggestion[]) => number, picked: Suggestion[], t: SilenceTuning): number {
  const ranges = tunedRanges(picked, t);
  if (!t.speed) return save(ranges);
  const fast = ranges.filter((s) => s.reason === 'silence');
  return save(ranges.filter((s) => s.reason !== 'silence')) + save(fast) * (1 - 1 / t.speed);
}
