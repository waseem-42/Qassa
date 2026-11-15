import { CAPTION_TRACK } from './captions.ts';
import { graphicEntry } from './graphics.ts';
import { MAIN_TRACK, type Project } from './schema.ts';
import { mainClips, transitionHalf } from './timeline.ts';

// Sound effects: a small library synthesised by the server (no downloads, no licences), placed by
// hand or automatically on what happens on screen — a graphic coming in, a title popping up, a
// transition. Automatic ones carry AUTO_MARK in their label so re-running only replaces those.

export const SFX_TRACK = 'SFX';
export const AUTO_MARK = '◇';

export const SFX = {
  whoosh: { name: 'هووش', description: 'مرور هواء ناعم — دخول رسمة أو انتقال' },
  swoosh: { name: 'سووش', description: 'مرور سريع وحاد — سحب أو مسح' },
  click: { name: 'كلك', description: 'نقرة قصيرة — اختصار كيبورد أو زر' },
  pop: { name: 'بوب', description: 'فقاعة — ظهور عنوان أو وسم' },
  ding: { name: 'دنق', description: 'جرس صافي — نتيجة أو إنجاز' },
  impact: { name: 'ضربة', description: 'ضربة منخفضة — لحظة قوية أو فلاش' },
  riser: { name: 'تصاعد', description: 'صوت يتصاعد ثانية ونص — قبل كشف أو عنوان كبير' },
  tick: { name: 'تك', description: 'تكة خفيفة — عد أو تحديد' },
} as const;
export type SfxId = keyof typeof SFX;
export const SFX_IDS = Object.keys(SFX) as SfxId[];

export interface SfxCue { sfx: SfxId; at: number; volume: number; why: string }

/** Where effects belong in this edit (timeline seconds), at most one every 0.3s. Captions and plain cuts get none. */
/** The same automatic sound closer than this to its last use is dropped. */
export const SAME_SFX_GAP = 1.2;

export function sfxPlan(p: Project): SfxCue[] {
  const cues: SfxCue[] = [];
  const shown = (trackId: string) => !p.tracks.find((t) => t.id === trackId)?.hidden;
  for (const c of p.clips) {
    if (c.trackId === MAIN_TRACK || c.trackId === CAPTION_TRACK || !shown(c.trackId)) continue;
    if (c.graphic) {
      const name = graphicEntry(c.graphic).split('/').slice(-2, -1)[0] ?? '';
      const sfx: SfxId = name === 'keys' ? 'click' : name === 'callout' ? 'pop' : name === 'chapter' ? 'impact' : 'whoosh';
      // a graphic's entrance plays from its in-point; a split-off tail has no entrance
      if (c.in < 0.05) cues.push({ sfx, at: c.start, volume: sfx === 'impact' ? 0.5 : 0.6, why: `graphic ${name}` });
    } else if (c.text && (c.textStyle?.animation ?? 'fade') !== 'none') {
      cues.push({ sfx: 'pop', at: c.start, volume: 0.45, why: `text «${c.text.slice(0, 24)}»` });
    }
  }
  const main = mainClips(p);
  main.forEach((c, i) => {
    const h = transitionHalf(main[i - 1], c);
    if (!h) return;
    const kind = c.transition!.kind;
    if (kind === 'crossfade' || kind === 'dip') return; // soft transitions stay quiet
    const sfx: SfxId = kind === 'flash' ? 'impact' : kind === 'zoom' ? 'whoosh' : 'swoosh';
    // a whoosh peaks a little after it starts: start it just before the cut
    cues.push({ sfx, at: Math.max(0, c.start - Math.min(h, 0.2)), volume: 0.55, why: `transition ${kind}` });
  });
  cues.sort((a, b) => a.at - b.at);
  // keep effects apart: anything within 0.3 s of the last kept one, or the same sound again within
  // SAME_SFX_GAP (a title and the callout right after it), would read as a stutter — the first one stays
  const kept: SfxCue[] = [];
  for (const q of cues) {
    const last = kept[kept.length - 1];
    if (last && q.at - last.at < 0.3) continue;
    if (kept.some((k) => k.sfx === q.sfx && q.at - k.at < SAME_SFX_GAP)) continue;
    kept.push(q);
  }
  return kept.map((q) => ({ ...q, at: Math.round(q.at * 1000) / 1000 }));
}
