import { OpError, type Op } from './ops.ts';
import type { Project, TextStyle, Transcript } from './schema.ts';
import { speechClips } from './speech.ts';
import { clipEnd } from './timeline.ts';

export const CAPTION_TRACK = 'CAP';

export interface CaptionOptions {
  maxWords?: number;
  maxChars?: number;
  /** a pause longer than this starts a new caption */
  pause?: number;
  style?: Partial<TextStyle>;
}

/**
 * Captions for the edited timeline: only words that survive the cut, timed where they now play,
 * chunked into short readable lines. Returns ops that replace the caption track.
 */
export function captionOps(p: Project, transcripts: (mediaId: string) => Transcript | undefined, o: CaptionOptions = {}): Op[] {
  const maxWords = o.maxWords ?? 7, maxChars = o.maxChars ?? 38, pause = o.pause ?? 0.45;
  type W = { t0: number; t1: number; w: string; mediaId: string; i: number; clipId: string; end: number };
  const placed: W[] = [];
  const clips = speechClips(p);
  const missing = [...new Set(clips.filter((c) => !transcripts(c.mediaId!)).map((c) => c.mediaId!))];
  if (missing.length) throw new OpError(`يحتاج تفريغ: ${missing.map((id) => p.media.find((m) => m.id === id)?.name ?? id).join('، ')} — اضغط «فرّغ الكلام»`);
  for (const c of clips) {
    const tr = c.mediaId ? transcripts(c.mediaId) : undefined;
    if (!tr) continue;
    for (const w of tr.words) {
      const mid = (w.t0 + w.t1) / 2;
      if (mid < c.in || mid >= c.out) continue;
      placed.push({ t0: c.start + (Math.max(w.t0, c.in) - c.in) / c.speed, t1: c.start + (Math.min(w.t1, c.out) - c.in) / c.speed, w: w.w, mediaId: tr.mediaId, i: w.i, clipId: c.id, end: clipEnd(c) });
    }
  }
  placed.sort((a, b) => a.t0 - b.t0);
  if (!placed.length) throw new OpError('لا يوجد كلام مفرّغ ضمن اللقطات؛ أضف ملف الكلام وفرّغه أولًا.');
  const chunks: W[][] = [];
  let cur: W[] = [];
  for (const w of placed) {
    const prev = cur[cur.length - 1];
    const text = [...cur, w].map((x) => x.w).join(' ');
    const sentenceEnd = prev && /[.!?؟،,]$/.test(prev.w) && cur.length >= 3;
    if (cur.length && (prev.clipId !== w.clipId || prev.mediaId !== w.mediaId || w.i !== prev.i + 1 || cur.length >= maxWords || text.length > maxChars || w.t0 - prev.t1 > pause || sentenceEnd)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);

  const ops: Op[] = [
    { op: 'add_track', track: { id: CAPTION_TRACK, kind: 'text', name: 'كابشن' } },
    { op: 'clear_track', trackId: CAPTION_TRACK },
  ];
  // the project's caption style (from a style preset), then this call's overrides
  const style: Partial<TextStyle> = { preset: 'caption', size: 46, weight: 600, x: 0.5, y: 0.86, align: 'center', animation: 'none', ...p.settings.captionStyle, ...o.style };
  chunks.forEach((ch, i) => {
    const start = ch[0].t0;
    const next = chunks[i + 1]?.[0].t0 ?? Infinity;
    // hold each line a little after its last word, never into the next line
    const end = Math.min(next, ch[0].end, Math.max(ch[ch.length - 1].t1 + 0.2, start + 0.8));
    const text = ch.map((x) => x.w).join(' ').replace(/[.،,]+$/, '');
    if (end - start > 0.05) ops.push({ op: 'add_text', trackId: CAPTION_TRACK, text, start: Math.round(start * 1000) / 1000, duration: Math.round((end - start) * 1000) / 1000, style, words: { mediaId: ch[0].mediaId, from: ch[0].i, to: ch.at(-1)!.i, clipId: ch[0].clipId } });
  });
  return ops;
}
