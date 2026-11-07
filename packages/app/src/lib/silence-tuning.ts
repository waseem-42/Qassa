import type { Op, Suggestion } from '@edit/shared';

// Silence cuts tuned by the viewer, like the "minimum silence" and "padding" knobs of auto-cut tools:
// silences shorter than `min` stay, and `pad` seconds of each silence edge stay as breathing room.

export interface SilenceTuning { min: number; pad: number }
export const DEFAULT_TUNING: SilenceTuning = { min: 0, pad: 0 };
const KEY = 'qassa.silence-tuning';

export function readTuning(): SilenceTuning {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    const min = Number(v.min), pad = Number(v.pad);
    return { min: Number.isFinite(min) ? Math.max(0, Math.min(3, min)) : 0, pad: Number.isFinite(pad) ? Math.max(0, Math.min(0.5, pad)) : 0 };
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
  if (t.pad === 0) return [{ op: 'resolve_suggestions', ids, accept: true }];
  // later ranges first, so each cut leaves the source times of the next one where they were
  const ops: Op[] = [...cut].sort((a, b) => b.t0 - a.t0).map((s) => ({ op: 'cut_range', mediaId: s.mediaId, t0: s.t0, t1: s.t1 }));
  ops.push({ op: 'resolve_suggestions', ids, accept: false });
  return ops;
}
