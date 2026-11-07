import type { Clip, Project, Word } from './schema.ts';
import { clipEnd } from './timeline.ts';

// Captions that light up the word being spoken (CapCut / Submagic style). A word-linked caption with
// `textStyle.highlight` knows when each of its words plays from the transcript; the preview colours the current
// word, and the export splits the caption into one still per word (chained like any other caption images).

type Words = (mediaId: string) => Word[] | undefined;

/** When each word of a word-linked caption starts on the timeline, in text order; null when the text was edited. */
export function captionWordStarts(p: Project, clip: Clip, words: Words): number[] | null {
  const ref = clip.words;
  if (!ref || !clip.text) return null;
  const transcript = words(ref.mediaId);
  if (!transcript) return null;
  const bound = transcript.slice(ref.from, ref.to + 1);
  const tokens = clip.text.split(/\s+/).filter(Boolean);
  if (!bound.length || tokens.length !== bound.length) return null;
  const sources = p.clips.filter((c) => c.mediaId === ref.mediaId && !c.text);
  const starts: number[] = [];
  for (const w of bound) {
    const mid = (w.t0 + w.t1) / 2, inside = (c: Clip) => mid >= c.in && mid < c.out;
    const c = sources.find((s) => s.id === ref.clipId && inside(s)) ?? sources.find(inside);
    if (!c) return null;
    starts.push(c.start + (Math.max(w.t0, c.in) - c.in) / c.speed);
  }
  return starts;
}

/** The word spoken at timeline time t (the first one before it starts, the last one after). */
export function activeWord(starts: number[], t: number): number {
  let k = 0;
  while (k + 1 < starts.length && starts[k + 1] <= t + 1e-6) k++;
  return k;
}

/** One piece per word: [start, end) on the timeline and the word lit in it. Pieces shorter than a frame merge forward. */
export function highlightPieces(clip: Clip, starts: number[], minLength = 1 / 30): { start: number; end: number; active: number }[] {
  const end = clipEnd(clip), out: { start: number; end: number; active: number }[] = [];
  starts.forEach((s, k) => {
    const a = k === 0 ? clip.start : Math.min(end, Math.max(clip.start, s));
    const b = k + 1 < starts.length ? Math.min(end, Math.max(clip.start, starts[k + 1])) : end;
    if (b - a < minLength) {
      // too short to show: the previous piece runs on, so there is never a gap
      if (out.length) out[out.length - 1].end = b;
      return;
    }
    out.push({ start: a, end: b, active: k });
  });
  if (out.length) { out[0].start = clip.start; out[out.length - 1].end = end; }
  return out;
}

/**
 * The project as the export draws it: each highlighted caption becomes one unanimated text clip per word,
 * with `active` naming the word each one lights. Everything else is untouched.
 */
export function expandHighlights(p: Project, words: Words, fps = p.settings.fps): { project: Project; active: Map<string, number> } {
  const active = new Map<string, number>();
  if (!p.clips.some((c) => c.text && c.words && c.textStyle?.highlight)) return { project: p, active };
  const r = (t: number) => Math.round(t * 1000) / 1000;
  const clips = p.clips.flatMap((c) => {
    if (!c.text || !c.words || !c.textStyle?.highlight) return [c];
    const starts = captionWordStarts(p, c, words);
    if (!starts) return [c];
    return highlightPieces(c, starts, 1 / fps).map((piece) => {
      const id = `${c.id}~${piece.active}`;
      active.set(id, piece.active);
      return { ...c, id, start: r(piece.start), in: 0, out: r(piece.end - piece.start), speed: 1, textStyle: { ...c.textStyle!, animation: 'none' as const } };
    });
  });
  return { project: { ...p, clips }, active };
}
