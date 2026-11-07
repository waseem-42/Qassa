import { MAIN_TRACK, TextStyle, outputSize, type Clip, type Project, type Settings } from './schema.ts';
import { clipDuration, clipEnd, fmtTime, mainClips, projectDuration } from './timeline.ts';
import { trackOverlaps } from './placement.ts';

// What a viewer would notice in the finished edit, found from the project alone (no rendering).
// The export dialog and Claude's `review` tool read the same list; findings never block an export.

export interface ReviewFinding {
  code: 'flash_frame' | 'short_text' | 'text_collision' | 'unsafe_area' | 'black_picture' | 'audio_only' | 'loud_music' | 'jump_cuts' | 'overlap' | 'open_note' | 'pending_ideas';
  severity: 'warn' | 'info';
  /** timeline seconds */
  at: number;
  end?: number;
  clipIds: string[];
  /** short, for the user (Arabic) */
  message: string;
  /** an edit that would fix it, for Claude */
  fix?: string;
}

const FLASH = 0.25;
const WORDS_PER_SECOND = 3;
const r2 = (v: number) => Math.round(v * 100) / 100;

const hidden = (p: Project, c: Clip) => !!p.tracks.find((t) => t.id === c.trackId)?.hidden;
const isText = (c: Clip) => c.text !== undefined && !c.mediaId;
/** A clip that puts a picture on screen (footage or a still), on the main track or a layer. */
function showsPicture(p: Project, c: Clip): boolean {
  if (hidden(p, c) || c.picture?.off || !c.mediaId) return false;
  const m = p.media.find((x) => x.id === c.mediaId);
  const track = p.tracks.find((t) => t.id === c.trackId);
  return !!m && m.kind !== 'audio' && (c.trackId === MAIN_TRACK || track?.kind === 'overlay');
}

/** Where a text box sits, as fractions of the frame (an estimate: the renderer sizes it to its text). */
function textBox(c: Clip, s: Pick<Settings, 'aspect' | 'resolution'>) {
  const st = TextStyle.parse(c.textStyle ?? {});
  const { width, height } = outputSize({ ...s, resolution: 1080 });
  const k = height / 1080;
  const lines = (c.text ?? '').split('\n');
  const pad = { title: 0, 'lower-third': 14, caption: 8, label: 6, card: 32 }[st.preset];
  const max = { title: .8, 'lower-third': .7, caption: .84, label: .5, card: .6 }[st.preset];
  const h = (st.size * 1.35 * lines.length + 2 * pad) * k / height;
  const w = Math.min(max, (Math.max(...lines.map((l) => l.length)) * st.size * .5 + 2 * pad * 2) * k / width);
  // align start/end anchors one edge at x; which edge depends on the text's direction, so take the wider guess
  const left = st.align === 'center' ? st.x - w / 2 : Math.max(0, st.x - w), right = st.align === 'center' ? st.x + w / 2 : Math.min(1, st.x + w);
  return { top: st.y - h / 2, bottom: st.y + h / 2, left, right };
}

export function editReview(p: Project, opts: { aspect?: Settings['aspect'] } = {}): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const duration = projectDuration(p);
  const settings = { ...p.settings, aspect: opts.aspect ?? p.settings.aspect };

  // flash frames: a picture on screen for a blink
  for (const c of p.clips) {
    if (!showsPicture(p, c) || clipDuration(c) >= FLASH) continue;
    out.push({ code: 'flash_frame', severity: 'warn', at: r2(c.start), end: r2(clipEnd(c)), clipIds: [c.id],
      message: `لقطة مدتها ${clipDuration(c).toFixed(2)}ث تظهر كوميض`, fix: `delete {clipId:'${c.id}'} or trim its neighbour over it` });
  }

  const texts = p.clips.filter((c) => isText(c) && !hidden(p, c)).sort((a, b) => a.start - b.start);
  // text gone before it can be read; captions linked to speech follow the voice and are left alone
  for (const c of texts) {
    if (c.words) continue;
    const words = (c.text ?? '').trim().split(/\s+/).filter(Boolean).length;
    const need = .5 + words / WORDS_PER_SECOND;
    if (!words || clipDuration(c) >= need) continue;
    out.push({ code: 'short_text', severity: 'warn', at: r2(c.start), end: r2(clipEnd(c)), clipIds: [c.id],
      message: `«${(c.text ?? '').slice(0, 24)}» يظهر ${clipDuration(c).toFixed(1)}ث، يحتاج ${need.toFixed(1)}ث للقراءة`, fix: `set_timing {clipId:'${c.id}', duration:${need.toFixed(1)}}` });
  }

  // two texts on screen at once in the same place
  const boxes = new Map(texts.map((c) => [c.id, textBox(c, settings)]));
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length && texts[j].start < clipEnd(texts[i]) - .05; j++) {
      const a = boxes.get(texts[i].id)!, b = boxes.get(texts[j].id)!;
      if (a.top >= b.bottom || b.top >= a.bottom || a.left >= b.right || b.left >= a.right) continue;
      const at = texts[j].start, end = Math.min(clipEnd(texts[i]), clipEnd(texts[j]));
      out.push({ code: 'text_collision', severity: 'warn', at: r2(at), end: r2(end), clipIds: [texts[i].id, texts[j].id],
        message: `نصّان فوق بعض: «${(texts[i].text ?? '').slice(0, 16)}» و«${(texts[j].text ?? '').slice(0, 16)}»`, fix: `update_clip textStyle.y of one of them, or set_timing so they don't meet` });
    }
  }

  // Shorts / Reels / TikTok draw their buttons on the right and the description at the bottom
  if (settings.aspect === '9:16') {
    // one finding per track: a caption track sits there line after line
    for (const t of p.tracks) {
      const hit = texts.filter((c) => c.trackId === t.id && (boxes.get(c.id)!.bottom > .8 || boxes.get(c.id)!.right > .88));
      if (!hit.length) continue;
      const one = hit.length === 1 ? `«${(hit[0].text ?? '').slice(0, 20)}»` : `${hit.length} نصوص على «${t.name}»`;
      out.push({ code: 'unsafe_area', severity: 'info', at: r2(hit[0].start), end: r2(clipEnd(hit.at(-1)!)), clipIds: hit.map((c) => c.id),
        message: `${one} تحت أزرار أو وصف المنصة في الشورتس`, fix: hit.length === 1 ? `update_clip {clipId:'${hit[0].id}', patch:{textStyle:{y:0.7}}}` : 'captions: regenerate with style {y:0.7}; other text: update_clip textStyle.y ≤ 0.7' });
    }
  }

  // black picture: nothing on screen
  const pictures = p.clips.filter((c) => showsPicture(p, c)).map((c) => [c.start, clipEnd(c)] as const).sort((a, b) => a[0] - b[0]);
  const black: [number, number][] = [];
  let covered = 0;
  for (const [a, b] of pictures) {
    if (a > covered + .05) black.push([covered, a]);
    covered = Math.max(covered, b);
  }
  if (duration > covered + .05) black.push([covered, duration]);
  const blackTotal = black.reduce((s, [a, b]) => s + b - a, 0);
  if (duration > 0 && blackTotal > duration / 2) {
    out.push({ code: 'audio_only', severity: 'info', at: 0, end: r2(duration), clipIds: [],
      message: `الصورة سوداء في ${Math.round((blackTotal / duration) * 100)}% من المقطع (صوت فقط)`, fix: 'add a picture, a graphic or a waveform on an overlay track if this is not intended' });
  } else {
    for (const [a, b] of black) {
      if (b - a < .1) continue;
      const over = p.clips.some((c) => !hidden(p, c) && (isText(c) || !!c.graphic) && c.start < b && clipEnd(c) > a);
      out.push({ code: 'black_picture', severity: over ? 'info' : 'warn', at: r2(a), end: r2(b), clipIds: [],
        message: `شاشة سوداء ${(b - a).toFixed(1)}ث${over ? ' خلف نص أو رسم' : ''}`, fix: 'cover it with footage, or close the gap' });
    }
  }

  // music loud under speech (ducking helps, but a bed above ~0.8 still fights the voice)
  const speech = p.clips.filter((c) => {
    const track = p.tracks.find((t) => t.id === c.trackId);
    const m = p.media.find((x) => x.id === c.mediaId);
    return !track?.muted && !!m && (m.kind === 'audio' || m.hasAudio) && c.volume > 0 && (c.trackId === MAIN_TRACK || (track?.kind === 'audio' && track.audio === 'voice'));
  });
  for (const c of p.clips) {
    const track = p.tracks.find((t) => t.id === c.trackId);
    if (track?.kind !== 'audio' || track.audio === 'voice' || track.muted || c.volume <= .8) continue;
    const under = speech.find((s) => s.start < clipEnd(c) && clipEnd(s) > c.start);
    if (!under) continue;
    out.push({ code: 'loud_music', severity: 'info', at: r2(Math.max(c.start, under.start)), end: r2(Math.min(clipEnd(c), clipEnd(under))), clipIds: [c.id],
      message: `الموسيقى عالية (${Math.round(c.volume * 100)}%) تحت الكلام`, fix: `update_clip {clipId:'${c.id}', patch:{volume:0.35}}` });
  }

  // runs of jump cuts in one shot with nothing changing the frame
  const main = mainClips(p);
  const jumps: number[] = [];
  for (let i = 1; i < main.length; i++) {
    const a = main[i - 1], b = main[i];
    const same = a.mediaId && a.mediaId === b.mediaId && Math.abs(b.in - a.out) > .05 && !b.transition;
    const framed = JSON.stringify(a.transform ?? null) !== JSON.stringify(b.transform ?? null);
    if (same && !framed) jumps.push(b.start);
  }
  for (let i = 0; i < jumps.length;) {
    let j = i;
    while (j + 1 < jumps.length && jumps[j + 1] - jumps[i] <= 10) j++;
    if (j - i + 1 > 3) {
      out.push({ code: 'jump_cuts', severity: 'info', at: r2(jumps[i]), end: r2(jumps[j]), clipIds: main.filter((c) => c.start >= jumps[i] - .001 && c.start <= jumps[j] + .001).map((c) => c.id),
        message: `${j - i + 1} قصات قفز متتالية بنفس الزاوية`, fix: 'alternate a light zoom: update_clip transform {scale:1.08–1.15} on every other piece' });
      i = j + 1;
    } else i++;
  }

  // leftovers the editor should see with their place on the timeline
  for (const t of p.tracks) {
    for (const s of trackOverlaps(p, t.id)) {
      out.push({ code: 'overlap', severity: 'warn', at: r2(s.start), end: r2(s.end), clipIds: p.clips.filter((c) => c.trackId === t.id && c.start < s.end && clipEnd(c) > s.start).map((c) => c.id),
        message: `لقطتان متداخلتان على «${t.name}»`, fix: "move {clipId, free:true} or add_clip with free:true" });
    }
  }
  for (const n of p.notes) if (n.status === 'open') out.push({ code: 'open_note', severity: 'info', at: r2(n.at), end: n.end, clipIds: [], message: `تعليق مفتوح: ${n.text.slice(0, 40)}` });
  if (p.ideas.length) out.push({ code: 'pending_ideas', severity: 'info', at: 0, clipIds: [], message: `${p.ideas.length} فكرة بصرية تنتظر قرارك`, fix: 'resolve_ideas' });

  return out.sort((a, b) => (a.severity === b.severity ? a.at - b.at : a.severity === 'warn' ? -1 : 1));
}

/** One line per finding, for Claude. */
export const reviewLine = (f: ReviewFinding) => `${f.severity === 'warn' ? '⚠' : '·'} ${fmtTime(f.at)}${f.end !== undefined ? `–${fmtTime(f.end)}` : ''} ${f.code}: ${f.message}${f.clipIds.length ? ` [${f.clipIds.join(', ')}]` : ''}${f.fix ? ` → ${f.fix}` : ''}`;
