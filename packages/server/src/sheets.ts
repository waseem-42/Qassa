import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { blurFitFilters, fitFilters, framingFilters, gradeFilters, sourceFilters } from '@edit/render';
import { bakedLut } from './luts.ts';
import {
  EPS, clipDuration, expandHighlights, clipEnd, fmtTime, graphicTime, mainClips, opacityAt, outputSize, placeAt, placeFilter, timelineToSource, transformAt,
  type Clip, type Media, type Project, type Word,
} from '@edit/shared';
import { graphicStills } from './graphics.ts';
import { renderTextImages } from './textimg.ts';

// Contact sheets let Claude look at the edit instead of guessing: frames from the edited
// timeline tiled into one image — composited like the render (framing, grade, b-roll, text,
// graphics), or just the main track when checking cuts.

export function ffmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true });
    let err = '';
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().slice(-500)))));
  });
}

interface Frame { t: number; label: string }

/**
 * One frame of a clip's media at timeline time t, as the render shows it: cropped/flipped, filled (zoom / focus) or
 * fitted (on black or blurred bars), turned, graded, see-through. A layer (b-roll) comes out as a transparent PNG at
 * its place's size, to be laid at its position; a main-track frame fills the frame over black.
 */
async function grabClip(p: Project, dir: string, c: Clip, m: Media, t: number, out: string, W: number, H: number, layer = false) {
  const local = t - c.start;
  const tr = transformAt(c.transform, local);
  const pic = c.picture, sf = sourceFilters(m, pic), opacity = opacityAt(c, local), rot = pic?.rotate ?? 0;
  const rad = ((rot * Math.PI) / 180).toFixed(6);
  const blur = !layer && pic?.fit === 'fit' && pic.bars === 'blur';
  const scale = layer ? placeAt(c, local).scale : 1;
  const vf = [
    ...sf.filters,
    ...(blur ? [blurFitFilters(sf.size, W, H, rot, 's')] : pic?.fit === 'fit' ? fitFilters(sf.size, W, H, !layer) : framingFilters(sf.size, { ...tr, keyframes: [] }, W, H)),
    ...(rot && !blur && !layer ? [`rotate=${rad}:ow=${W}:oh=${H}:c=black`] : []),
    ...gradeFilters(c.grade ?? p.settings.defaultGrade, (lut, mix) => bakedLut(dir, lut, mix)),
    ...(layer
      ? ['format=rgba', ...(scale !== 1 ? [`scale=w=trunc(iw*${scale.toFixed(4)}/2)*2:h=trunc(ih*${scale.toFixed(4)}/2)*2`] : []),
        ...(rot ? [`rotate=${rad}:ow='rotw(${rad})':oh='roth(${rad})':c=none`] : []), ...(opacity < 1 ? [`colorchannelmixer=aa=${opacity.toFixed(3)}`] : [])]
      : opacity < 1 ? [`colorchannelmixer=rr=${opacity.toFixed(3)}:gg=${opacity.toFixed(3)}:bb=${opacity.toFixed(3)}`] : []),
  ].join(',');
  const src = W > 960 || !m.proxy ? m.path : m.proxy; // a full-size frame from the original, small ones from the proxy
  const input = m.kind === 'image' ? ['-i', src] : ['-ss', (c.in + local * c.speed).toFixed(3), '-i', src];
  // every frame of a sheet in one pixel format: the tiler drops frames when it changes (opacity makes RGB)
  await ffmpeg([...input, '-frames:v', '1', '-vf', vf, ...(layer ? [] : ['-pix_fmt', 'yuvj420p', '-q:v', '3']), out], dir);
}

async function grabMain(p: Project, dir: string, t: number, out: string, W: number, H: number) {
  const hit = timelineToSource(p, t);
  const m = hit && p.media.find((x) => x.id === hit.clip.mediaId);
  // nothing there, or a sound-only clip (a podcast on the main track): black, as the render shows it
  if (!hit || !m || m.kind === 'audio' || hit.clip.picture?.off) return ffmpeg(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-frames:v', '1', out], dir);
  await grabClip(p, dir, hit.clip, m, t, out, W, H);
}

const shownAt = (p: Project, c: Clip, t: number) => !p.tracks.find((x) => x.id === c.trackId)?.hidden && t >= c.start && t < clipEnd(c);
const isOverlayMedia = (p: Project, c: Clip) =>
  !c.picture?.off && p.tracks.find((x) => x.id === c.trackId)?.kind === 'overlay' && p.media.some((m) => m.id === c.mediaId && m.kind !== 'audio');

/** Frames of the edit as the render shows them: the main track, then b-roll, text and graphics on top. */
export async function compositeFrames(name: string, edited: Project, dir: string, times: number[], W: number, H: number, tmp: string): Promise<void> {
  // highlighted captions as the export draws them: one still per spoken word
  const transcripts = new Map<string, Word[] | undefined>();
  const words = (m: string) => {
    if (!transcripts.has(m)) { try { transcripts.set(m, JSON.parse(readFileSync(join(dir, 'analysis', m, 'transcript.json'), 'utf8')).words); } catch { transcripts.set(m, undefined); } }
    return transcripts.get(m);
  };
  const { project: p, active } = expandHighlights(edited, words);
  const layers = (t: number) => p.clips
    .filter((c) => c.trackId !== 'V1' && shownAt(p, c, t) && (c.text || c.graphic || isOverlayMedia(p, c)))
    .sort((a, b) => Number(!!a.text) - Number(!!b.text) || p.tracks.findIndex((t) => t.id === a.trackId) - p.tracks.findIndex((t) => t.id === b.trackId) || a.start - b.start);

  const texts = await renderTextImages(dir, p.clips.filter((c) => c.text && times.some((t) => shownAt(p, c, t))), W, H, p.settings.theme, active);

  // graphics: one page per clip, a still for each frame it is in
  const stills = new Map<string, string>(); // `${clipId}@${frame}` -> file
  for (const c of p.clips.filter((x) => x.graphic && times.some((t) => shownAt(p, x, t)))) {
    const at = times.map((t, i) => ({ t, i })).filter(({ t }) => shownAt(p, c, t));
    const files = await graphicStills(name, dir, c, p.settings, at.map(({ t }) => graphicTime(c, t)), W, join(dir, tmp), { backdrop: false, prefix: `g-${c.id}-` });
    at.forEach(({ i }, k) => stills.set(`${c.id}@${i}`, files[k]));
  }

  await Promise.all(times.map(async (t, i) => {
    const base = `${tmp}/base${i}.jpg`;
    await grabMain(p, dir, t, base, W, H);
    const inputs = ['-i', base];
    const steps: string[] = [];
    let label = '0:v', n = 1;
    for (const c of layers(t)) {
      let prep = 'format=rgba';
      let pos = '';
      if (c.text) {
        const img = texts.get(c.id);
        if (!img) continue;
        inputs.push('-i', img);
        // the fade the render applies at this moment
        const dur = clipDuration(c), local = t - c.start, d = Math.min(0.35, dur / 3);
        const alpha = (c.textStyle?.animation ?? 'fade') === 'none' ? 1 : Math.max(0, Math.min(1, local / d, (dur - local) / d));
        if (alpha < 0.999) prep += `,colorchannelmixer=aa=${alpha.toFixed(3)}`;
      } else if (c.graphic) {
        const img = stills.get(`${c.id}@${i}`);
        if (!img) continue;
        inputs.push('-i', img);
        const pl = placeFilter(placeAt(c, t - c.start), W, H), opacity = opacityAt(c, t - c.start);
        if (pl?.scale) prep += `,${pl.scale}`;
        if (opacity < 0.999) prep += `,colorchannelmixer=aa=${opacity.toFixed(3)}`;
        if (pl) pos = `x='${pl.x}':y='${pl.y}':`;
      } else {
        // b-roll: its own transparent picture (size, turn, opacity), laid at its place like the render
        const f = `${tmp}/ov${i}-${n}.png`;
        await grabClip(p, dir, c, p.media.find((x) => x.id === c.mediaId)!, t, f, W, H, true);
        inputs.push('-i', f);
        const pl = placeAt(c, t - c.start);
        pos = `x='(main_w-overlay_w)/2+${(pl.dx * W).toFixed(2)}':y='(main_h-overlay_h)/2+${(pl.dy * H).toFixed(2)}':`;
      }
      steps.push(`[${n}:v]${prep}[l${n}]`, `[${label}][l${n}]overlay=${pos}format=auto[o${n}]`);
      label = `o${n}`;
      n++;
    }
    const out = `${tmp}/f${String(i).padStart(3, '0')}.jpg`;
    if (!steps.length) await ffmpeg(['-i', base, '-q:v', '3', out], dir);
    // same pixel format as the plain frames: the tiler can't change formats mid-sequence
    else await ffmpeg([...inputs, '-filter_complex', steps.join(';'), '-map', `[${label}]`, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '3', out], dir);
  }));
}

/**
 * Tile frames into one JPEG; returns its bytes. composite = with everything the render shows on
 * top of the main track; false = the main track only (checking cuts).
 */
export async function contactSheet(name: string, p: Project, dir: string, frames: Frame[], cols: number, width = 480, composite = true): Promise<Buffer> {
  const tmp = `cache/sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(join(dir, tmp), { recursive: true });
  const { width: ow, height: oh } = outputSize(p.settings);
  const W = Math.round(width / 2) * 2, H = Math.round((width * oh) / ow / 2) * 2;
  try {
    if (composite) await compositeFrames(name, p, dir, frames.map((f) => f.t), W, H, tmp);
    else await Promise.all(frames.map((f, i) => grabMain(p, dir, f.t, `${tmp}/f${String(i).padStart(3, '0')}.jpg`, W, H)));
    return await tileImages(join(dir, tmp, 'f%03d.jpg'), frames.length, cols, dir);
  } finally {
    rmSync(join(dir, tmp), { recursive: true, force: true });
  }
}

/** One frame of the edit at full size, as the render shows it (a still for a thumbnail, a check, a post). */
export async function frameImage(name: string, p: Project, dir: string, t: number): Promise<Buffer> {
  const tmp = `cache/frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(join(dir, tmp), { recursive: true });
  const { width: W, height: H } = outputSize(p.settings);
  try {
    await compositeFrames(name, p, dir, [t], W, H, tmp);
    return readFileSync(join(dir, tmp, 'f000.jpg'));
  } finally {
    rmSync(join(dir, tmp), { recursive: true, force: true });
  }
}

/** Tile a numbered image sequence (ffmpeg pattern) into one JPEG next to it; returns its bytes. */
export async function tileImages(pattern: string, count: number, cols: number, cwd: string): Promise<Buffer> {
  const out = join(dirname(pattern), 'sheet.jpg');
  const c = Math.max(1, Math.min(cols, count));
  await ffmpeg(['-framerate', '1', '-i', pattern, '-vf', `tile=${c}x${Math.ceil(count / c)}:padding=6:margin=6:color=0x202020`, '-frames:v', '1', '-q:v', '3', out], cwd);
  return readFileSync(out);
}

export function evenTimes(t0: number, t1: number, count: number): number[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * (i + 0.5)) / n);
}

export interface CutReport {
  index: number;
  at: number;
  before: string;
  after: string;
  problems: string[];
}

/** For every cut on the main track: the words on each side and whether a word got sliced. */
export function cutReport(p: Project, words: (mediaId: string) => Word[] | undefined): CutReport[] {
  const clips = mainClips(p);
  const out: CutReport[] = [];
  for (let i = 1; i < clips.length; i++) {
    const a = clips[i - 1], b = clips[i];
    const wa = (a.mediaId && words(a.mediaId)) || [];
    const wb = (b.mediaId && words(b.mediaId)) || [];
    const problems: string[] = [];
    const sliceA = wa.find((w) => w.t0 < a.out - 0.03 && w.t1 > a.out + 0.03);
    const sliceB = wb.find((w) => w.t0 < b.in - 0.03 && w.t1 > b.in + 0.03);
    if (sliceA) problems.push(`cuts inside «${sliceA.w}» (end of previous clip)`);
    if (sliceB) problems.push(`cuts inside «${sliceB.w}» (start of next clip)`);
    const tailA = wa.filter((w) => w.t1 <= a.out + EPS && w.t1 > a.out - 6).slice(-4).map((w) => w.w).join(' ');
    const headB = wb.filter((w) => w.t0 >= b.in - EPS && w.t0 < b.in + 6).slice(0, 4).map((w) => w.w).join(' ');
    const lastWord = wa.filter((w) => w.t1 <= a.out + EPS).at(-1);
    const nextWord = wb.find((w) => w.t0 >= b.in - EPS);
    if (lastWord && a.out - lastWord.t1 < 0.04) problems.push('no breath after the last word (may sound clipped)');
    if (nextWord && nextWord.t0 - b.in < 0.01) problems.push('next word starts right at the cut (may sound clipped)');
    if (lastWord && nextWord) {
      const air = (a.out - lastWord.t1) / a.speed + (nextWord.t0 - b.in) / b.speed;
      if (air > 1.2) problems.push(`${air.toFixed(1)}s of silence across the cut`);
    }
    out.push({ index: i, at: b.start, before: tailA, after: headB, problems });
  }
  return out;
}

export function cutFrames(p: Project, cuts: CutReport[], fps: number): Frame[] {
  const frames: Frame[] = [];
  for (const c of cuts) {
    frames.push({ t: Math.max(0, c.at - 1.5 / fps), label: `cut ${c.index} before` }, { t: c.at + 0.5 / fps, label: `cut ${c.index} after` });
  }
  return frames;
}
