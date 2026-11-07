import type { Clip, Project, Word } from './schema.ts';
import { clipEnd } from './timeline.ts';

export type ClipId = (prefix: string, parent?: string, existing?: string) => string;
const round = (t: number) => Math.round(t * 1000) / 1000;
export const sourceTiming = (p: Project) => JSON.stringify(p.clips.filter((c) => c.mediaId).map((c) => [c.id, c.mediaId, c.trackId, c.start, c.in, c.out, c.speed]));

/** Word-bound captions follow source pieces, rather than collapsing onto a deleted timeline anchor. */
export function syncCaptionWords(p: Project, words: ((mediaId: string) => Word[] | undefined) | undefined, parents: Map<string, Set<string>>, newId: ClipId) {
  const sources = p.clips.filter((c) => c.mediaId && !c.words), next: Clip[] = [];
  for (const caption of p.clips) {
    const ref = caption.words;
    if (!ref) { next.push(caption); continue; }
    const clips = sources.filter((c) => c.mediaId === ref.mediaId && (!ref.clipId || c.id === ref.clipId || parents.get(c.id)?.has(ref.clipId))).sort((a, b) => a.start - b.start);
    if (!clips.length) continue;
    const transcript = words?.(ref.mediaId);
    if (!transcript) { next.push(caption); continue; } // don't invent word boundaries when analysis is unavailable
    const bound = transcript.slice(ref.from, ref.to + 1);
    const groups: { source: Clip; words: Word[]; start: number; end: number }[] = [];
    for (const source of clips) {
      const kept = bound.filter((w) => (w.t0 + w.t1) / 2 >= source.in && (w.t0 + w.t1) / 2 < source.out);
      for (const w of kept) {
        const start = source.start + (Math.max(w.t0, source.in) - source.in) / source.speed, end = source.start + (Math.min(w.t1, source.out) - source.in) / source.speed;
        const previous = groups.at(-1);
        if (previous?.source.id === source.id && previous.words.at(-1)!.i + 1 === w.i) { previous.words.push(w); previous.end = end; }
        else groups.push({ source, words: [w], start, end });
      }
    }
    groups.forEach((g, i) => {
      const from = g.words[0].i, to = g.words.at(-1)!.i;
      const end = Math.min(clipEnd(g.source), groups[i + 1]?.start ?? Infinity, Math.max(g.end + .2, g.start + .8));
      if (end - g.start <= .05) return;
      next.push({ ...caption, id: i ? newId('t') : caption.id, start: round(g.start), in: 0, out: round(end - g.start), speed: 1,
        text: groups.length === 1 && from === ref.from && to === ref.to ? caption.text : g.words.map((w) => w.w).join(' ').replace(/[.،,]+$/, ''),
        words: { mediaId: ref.mediaId, from, to, clipId: g.source.id } });
    });
  }
  // Keep the readable hold after each line, but never into the following generated line.
  const linked = next.filter((c) => c.words).sort((a, b) => b.start - a.start), following = new Map<string, Clip>();
  for (const c of linked) {
    const after = following.get(c.trackId);
    if (after && after.start > c.start) c.out = round(Math.min(c.out, after.start - c.start));
    following.set(c.trackId, c);
  }
  const seen = new Set<string>();
  p.clips = next.filter((c) => { if (!c.words) return true; const key = JSON.stringify([c.trackId, c.words, c.start, c.out, c.text, c.textStyle]); if (seen.has(key)) return false; seen.add(key); return true; });
}
