import { createHash } from 'node:crypto';
import {
  type Clip,
  type Grade,
  type Key,
  type Keyframe,
  type Media,
  type Picture,
  type Project,
  type Track,
  type Transform,
  clipDuration,
  clipEnd,
  keyAt,
  mainClips,
  MAIN_TRACK,
  outputSize,
  placeFilter,
  projectDuration,
  transitionHalf,
} from '@edit/shared';

// Compiles a project into ffmpeg jobs. Every main-track clip becomes one cached, frame-accurate
// segment (trim + speed + grade + framing + click-free audio); a final pass concatenates them and
// lays overlays, text and music on top. All paths are relative to the project folder, which is
// ffmpeg's working directory — this keeps Windows drive letters out of filtergraphs.

export type Quality = 'preview' | 'final';

export interface RenderOptions {
  quality: Quality;
  nvenc: boolean;
  /** stat of a project-relative file, used to invalidate the segment cache */
  fileKey: (rel: string) => string;
  /** project-relative PNG for a text clip (rendered by the server beforehand) */
  textImage?: (clip: Clip) => string | undefined;
  /** project-relative transparent video of an HTML graphic clip, already timed to the clip */
  graphicVideo?: (clip: Clip) => string | undefined;
  /** transparent full-frame PNG (in cache/text/) used between static text clips */
  blankImage?: string;
  /** a LUT with its strength baked in (identity mixed with the LUT), so no split/blend is needed */
  lutFile?: (lut: string, mix: number) => string;
  output?: string;
  /** final pass encoding (segments stay H.264 intermediates) */
  codec?: 'h264' | 'h265';
  level?: 'small' | 'balanced' | 'high';
  /** only this part of the timeline, in seconds */
  range?: [number, number];
  /** sound only: no picture in the output */
  audio?: 'mp3' | 'wav';
}

export interface FfmpegJob {
  args: string[];
  output: string;
  duration: number; // seconds of output, for progress
  cached?: boolean;
}

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  duration: number;
  segments: (FfmpegJob & { clipId: string; hash: string })[];
  concatList: { path: string; body: string };
  /** other files the passes read: static text streams, keyframe commands (sendcmd) */
  files: { path: string; body: string }[];
  /** the sound-only pass that measures the mix; its gain replaces LOUDNESS_GAIN in the final pass (no sound to level: none) */
  measure?: { target: number; args: string[] };
  final: FfmpegJob;
}

const SEGMENT_VERSION = 4;
/** stands for the loudness gain (dB) in the final pass until the mix is measured */
export const LOUDNESS_GAIN = '{{gain}}';
const n = (x: number, d = 4) => Number(x.toFixed(d)).toString();

function videoCodec(quality: Quality, nvenc: boolean, stage: 'segment' | 'final', codec: RenderOptions['codec'] = 'h264', level: RenderOptions['level'] = 'balanced'): string[] {
  const shift = stage === 'final' ? { small: 6, balanced: 0, high: -3 }[level] : 0;
  const cq = (quality === 'preview' ? 25 : stage === 'segment' ? 18 : 19) + shift;
  if (codec === 'h265') return nvenc
    ? ['-c:v', 'hevc_nvenc', '-preset', quality === 'preview' ? 'p2' : 'p4', '-rc', 'vbr', '-cq', String(cq + 2), '-b:v', '0', '-bf', '0', '-tag:v', 'hvc1']
    : ['-c:v', 'libx265', '-preset', quality === 'preview' ? 'ultrafast' : 'medium', '-crf', String(cq + 3), '-tag:v', 'hvc1'];
  return nvenc
    ? ['-c:v', 'h264_nvenc', '-preset', quality === 'preview' ? 'p2' : 'p4', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0', '-bf', '0']
    : ['-c:v', 'libx264', '-preset', quality === 'preview' ? 'ultrafast' : 'medium', '-crf', String(cq - 2)];
}

const lut3d = (file: string) => `lut3d=file='${file.replace(/\\/g, '/').replace(/'/g, "\\'")}':interp=trilinear`;

/** `tag` keeps the labels of the unbaked LUT mix unique when two clips share one graph (a transition). */
export function gradeFilters(g: Grade | undefined, lutFile?: RenderOptions['lutFile'], tag = ''): string[] {
  if (!g) return [];
  const f: string[] = [];
  if (g.lut) {
    const lut = lut3d(g.lut);
    if (g.lutMix >= 0.999) f.push(lut);
    // baked strength: one lut3d pass, mixed in RGB exactly like the preview shader
    else if (g.lutMix > 0.001 && lutFile) f.push(lut3d(lutFile(g.lut, g.lutMix)));
    // fallback without a baked LUT. blend = top*opacity + bottom*(1-opacity): graded layer on top
    else if (g.lutMix > 0.001) f.push(`split[gA${tag}][gB${tag}];[gB${tag}]${lut}[gL${tag}];[gL${tag}][gA${tag}]blend=all_mode=normal:all_opacity=${n(g.lutMix, 3)}`);
  }
  if (g.exposure !== 0 || g.contrast !== 1 || g.saturation !== 1 || g.gamma !== 1)
    f.push(`eq=brightness=${n(g.exposure, 3)}:contrast=${n(g.contrast, 3)}:saturation=${n(g.saturation, 3)}:gamma=${n(g.gamma, 3)}`);
  if (Math.abs(g.temperature - 6500) > 1) f.push(`colortemperature=temperature=${Math.round(g.temperature)}`);
  return f;
}

/**
 * Piecewise expression over keys, eased between them by each key's ease (same as keyAt in the editor).
 * `tv` is the time the keys count from (the clip start), e.g. `(t-12.5)` on the timeline.
 */
export function keyExpr(keys: Key[] | undefined, base: number, tv = 't'): string {
  if (!keys?.length) return n(base);
  const k = [...keys].sort((a, b) => a.t - b.t);
  let expr = n(k[k.length - 1].v);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i], b = k[i + 1];
    const span = Math.max(1e-3, b.t - a.t);
    const u = `clip((${tv}-${n(a.t)})/${n(span)},0,1)`;
    const ease = a.ease === 'linear' ? u : a.ease === 'in' ? `(${u})*(${u})` : a.ease === 'out' ? `(${u})*(2-(${u}))` : a.ease === 'hold' ? '0' : `(${u})*(${u})*(3-2*(${u}))`;
    expr = `if(lt(${tv},${n(b.t)}),${n(a.v)}+(${n(b.v - a.v)})*${ease},${expr})`;
  }
  return `if(lt(${tv},${n(k[0].t)}),${n(k[0].v)},${expr})`;
}

function kfExpr(kfs: Keyframe[], key: 'scale' | 'x' | 'y', base: number): string {
  return keyExpr(kfs.map((k) => ({ t: k.t, v: k[key], ease: k.ease })), base);
}

/**
 * Voice cleanup for a clip's sound: a high-pass under the voice (rumble, hum) and FFT noise reduction that learns the
 * background as it goes; strength 0..1 sets how many dB of noise come off (6..30). Nothing when off.
 */
export function denoiseFilters(strength: number | undefined): string[] {
  if (!strength || strength <= 0) return [];
  const s = Math.min(1, strength);
  return [`highpass=f=${Math.round(60 + 30 * s)}`, `afftdn=nr=${n(6 + 24 * s, 1)}:nf=-${Math.round(40 - 10 * s)}:tn=1`];
}

/** Keys seen from a piece that starts `off` seconds into its clip. */
const shiftKeys = (keys: Key[] | undefined, off: number) => (keys && off ? keys.map((k) => ({ ...k, t: k.t - off })) : keys);

/**
 * Commands for ffmpeg's sendcmd that set a filter's options to a keyed value, once per frame where it changes
 * (colorchannelmixer has no time expressions). Times count from the piece's own 0.
 */
export function keyCommands(keys: Key[], len: number, fps: number, set: (v: number) => string): string {
  const lines: string[] = [];
  let last = NaN;
  for (let f = 0; f <= Math.ceil(len * fps); f++) {
    const t = f / fps, v = Math.round(keyAt(keys, t, keys[0].v) * 1000) / 1000;
    if (v === last) continue;
    lines.push(`${n(t)} ${set(v)};`);
    last = v;
  }
  return lines.join('\n') + '\n';
}

/** Crop and flip the source (before it is framed); returns the filters and the picture's size after the crop. */
export function sourceFilters(m: Pick<Media, 'width' | 'height'>, pic: Picture | undefined): { filters: string[]; size: Pick<Media, 'width' | 'height'> } {
  if (!pic) return { filters: [], size: m };
  const { l, t, r, b } = pic.crop;
  const f: string[] = [];
  if (l || t || r || b) f.push(`crop=w=trunc(iw*${n(1 - l - r)}/2)*2:h=trunc(ih*${n(1 - t - b)}/2)*2:x=trunc(iw*${n(l)}):y=trunc(ih*${n(t)})`);
  if (pic.flipX) f.push('hflip');
  if (pic.flipY) f.push('vflip');
  return { filters: f, size: { width: Math.round((m.width || 0) * (1 - l - r)), height: Math.round((m.height || 0) * (1 - t - b)) } };
}

/** The whole picture inside the frame: scaled to fit, centred on black bars when `pad` (a main-track clip). */
export function fitSize(m: Pick<Media, 'width' | 'height'>, W: number, H: number): { width: number; height: number } {
  const iw = m.width || W, ih = m.height || H;
  const s = Math.min(W / iw, H / ih);
  return { width: Math.min(W, Math.max(2, Math.round((iw * s) / 2) * 2)), height: Math.min(H, Math.max(2, Math.round((ih * s) / 2) * 2)) };
}

export function fitFilters(m: Pick<Media, 'width' | 'height'>, W: number, H: number, pad: boolean): string[] {
  const { width: sw, height: sh } = fitSize(m, W, H);
  return [`scale=${sw}:${sh}:flags=lanczos`, ...(pad && (sw !== W || sh !== H) ? [`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`] : [])];
}

const radians = (deg: number) => n((deg * Math.PI) / 180, 6);

/**
 * The whole picture on a blurred, enlarged copy of itself (a main-track clip): split, the copy covers the frame
 * small and soft, the picture is fitted (and turned, if rotated) and laid in the middle. `tag` keeps the labels
 * unique when two clips share one graph (a transition).
 */
export function blurFitFilters(m: Pick<Media, 'width' | 'height'>, W: number, H: number, rotate: number, tag: string): string {
  const bw = Math.max(16, Math.round(W / 24) * 2), bh = Math.max(16, Math.round(H / 24) * 2);
  const r = Math.max(1, Math.round(Math.min(bw, bh) / 11)); // the same softness at any size (8 at 1080p)
  const fg = [...fitFilters(m, W, H, false), ...(rotate ? ['format=rgba', `rotate=${radians(rotate)}:ow='rotw(${radians(rotate)})':oh='roth(${radians(rotate)})':c=none`] : [])];
  return [
    `split=2[pf${tag}][pb${tag}]`,
    `[pb${tag}]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},format=gbrp,boxblur=${r}:3,scale=${W}:${H}:flags=bicubic,eq=brightness=-0.06:saturation=0.9[pg${tag}]`,
    `[pf${tag}]${fg.join(',')}[pp${tag}]`,
    `[pg${tag}][pp${tag}]overlay=x='(main_w-overlay_w)/2':y='(main_h-overlay_h)/2'`,
  ].join(';');
}

/** Scale to cover the output frame (times zoom) and crop around the focus point. */
export function framingFilters(m: Pick<Media, 'width' | 'height'>, tr: Transform | undefined, W: number, H: number): string[] {
  const iw = m.width || W, ih = m.height || H;
  const cover = Math.max(W / iw, H / ih);
  const kfs = tr?.keyframes ?? [];
  if (!kfs.length) {
    const s = cover * (tr?.scale ?? 1);
    const sw = Math.max(W, Math.round((iw * s) / 2) * 2), sh = Math.max(H, Math.round((ih * s) / 2) * 2);
    const fx = tr?.x ?? 0.5, fy = tr?.y ?? 0.5;
    const x = Math.round(Math.min(Math.max(sw * fx - W / 2, 0), sw - W));
    const y = Math.round(Math.min(Math.max(sh * fy - H / 2, 0), sh - H));
    const f = [`scale=${sw}:${sh}:flags=lanczos`];
    if (sw !== W || sh !== H) f.push(`crop=${W}:${H}:${x}:${y}`);
    return f;
  }
  const z = kfExpr(kfs, 'scale', tr?.scale ?? 1);
  const fx = kfExpr(kfs, 'x', tr?.x ?? 0.5), fy = kfExpr(kfs, 'y', tr?.y ?? 0.5);
  // eval=frame lets the scale follow t; crop x/y are evaluated per frame anyway
  return [
    `scale=w='2*trunc(${iw}*${n(cover, 6)}*(${z})/2)':h='2*trunc(${ih}*${n(cover, 6)}*(${z})/2)':eval=frame:flags=bicubic`,
    `crop=${W}:${H}:x='clip(iw*(${fx})-${W / 2},0,iw-${W})':y='clip(ih*(${fy})-${H / 2},0,ih-${H})'`,
  ];
}

function atempoChain(speed: number): string[] {
  const f: string[] = [];
  let s = speed;
  while (s > 2) { f.push('atempo=2'); s /= 2; }
  while (s < 0.5) { f.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-4) f.push(`atempo=${n(s, 5)}`);
  return f;
}

export function compile(p: Project, opts: RenderOptions): RenderPlan {
  const preview = opts.quality === 'preview';
  const size = outputSize({ ...p.settings, resolution: preview ? Math.min(720, p.settings.resolution) : p.settings.resolution });
  const { width: W, height: H } = size;
  const fps = p.settings.fps;
  const fade = p.settings.cutFade;
  const media = new Map(p.media.map((m) => [m.id, m]));

  const segments: RenderPlan['segments'] = [];
  const main = mainClips(p).filter((c) => media.has(c.mediaId ?? ''));
  // half of each transition on either side of its cut, never more than ~half of either clip
  const half = main.map((c, i) => i && Math.abs(clipEnd(main[i - 1]) - c.start) < .002 ? transitionHalf(main[i - 1], c) : 0);
  // whole frames, rounded on the cumulative timeline so segments never drift or overlap
  const frameAt = (t: number) => Math.round(t * fps);
  const srcOf = (m: Media) => (preview && m.proxy ? m.proxy : m.path);
  const gradeOf = (c: Clip) => c.grade ?? p.settings.defaultGrade;
  const hasAudioOf = (c: Clip, m: Media) => m.kind !== 'image' && m.hasAudio && (c.volume > 0 || !!c.anim?.volume?.some((k) => k.v > 0));
  /** keyframe times are relative to the clip start; a piece starting `off` seconds in sees them earlier */
  const shiftKf = (tr: Transform | undefined, off: number): Transform | undefined =>
    tr && off !== 0 && tr.keyframes.length ? { ...tr, keyframes: tr.keyframes.map((k) => ({ ...k, t: k.t - off })) } : tr;
  let tags = 0;
  const files: RenderPlan['files'] = [];
  /** a sendcmd file (named by its content, so a segment's cache key follows what it says) */
  const cmdFile = (body: string) => {
    const path = `cache/anim/${createHash('sha1').update(body).digest('hex').slice(0, 16)}.cmd`;
    if (!files.some((f) => f.path === path)) files.push({ path, body });
    return path;
  };
  /**
   * See-through: `channels` of colorchannelmixer scaled by the opacity — aa on a layer with alpha, rr/gg/bb on the
   * main track (over black). With keys, sendcmd sets it frame by frame over a piece `len` seconds long.
   */
  const opacityFilters = (keys: Key[] | undefined, base: number, len: number, channels: string[]): string[] => {
    const set = (name: string, v: number) => channels.map((ch) => `${name}${ch}=${n(v, 3)}`);
    if (!keys?.length) return base < 1 ? [`colorchannelmixer=${set('', base).join(':')}`] : [];
    const name = `colorchannelmixer@o${++tags}`;
    const body = keyCommands(keys, len, fps, (v) => channels.map((ch) => `${name} ${ch} ${n(v, 3)}`).join(', '));
    return [`sendcmd=f=${cmdFile(body)}`, `${name}=${set('', keyAt(keys, 0, base)).join(':')}`];
  };
  /**
   * A main-track picture moved / resized (place, keyable): the framed picture scaled about the frame centre and
   * shifted, over black — like a layer, but the frame below is empty. `off`: the piece starts that far into the clip.
   */
  const mainPlace = (c: Clip, off: number): string[] => {
    const a = c.anim, pl = c.place;
    const keyed = !!(a?.dx?.length || a?.dy?.length || a?.scale?.length);
    if (!keyed && (!pl || (pl.scale === 1 && !pl.dx && !pl.dy))) return []; // at full size the anchor changes nothing
    const tag = ++tags, s = pl?.scale ?? 1, sk = shiftKeys(a?.scale, off);
    const max = sk?.length ? Math.max(...sk.map((k) => k.v)) : s;
    const fg = sk?.length
      ? ['format=rgba', `scale=w='max(2,2*trunc(iw*(${keyExpr(sk, s)})/2))':h='max(2,2*trunc(ih*(${keyExpr(sk, s)})/2))':eval=frame`, `pad=w=${Math.ceil((W * max) / 2) * 2 + 2}:h=${Math.ceil((H * max) / 2) * 2 + 2}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`]
      : s !== 1 ? [`scale=w='max(2,2*trunc(iw*${n(s)}/2))':h='max(2,2*trunc(ih*${n(s)}/2))'`] : ['null'];
    const at = (keys: Key[] | undefined, base: number, size: number) => (keys?.length ? `(${keyExpr(keys, base)})*${size}` : n(base * size, 2));
    const sv = sk?.length ? `(${keyExpr(sk, s)})` : n(s);
    const lean = (k: number, size: number) => (Math.abs(k - 0.5) < 1e-6 ? '' : `+(${n(k - 0.5)})*${size}*(1-${sv})`);
    const x = `(W-w)/2+${at(shiftKeys(a?.dx, off), pl?.dx ?? 0, W)}${lean(pl?.ax ?? 0.5, W)}`, y = `(H-h)/2+${at(shiftKeys(a?.dy, off), pl?.dy ?? 0, H)}${lean(pl?.ay ?? 0.5, H)}`;
    return [`${fg.join(',')}[pf${tag}];color=c=black:s=${W}x${H}:r=${fps}[pb${tag}];[pb${tag}][pf${tag}]overlay=x='${x}':y='${y}':shortest=1:eval=${keyed ? 'frame' : 'init'}`];
  };
  const videoChain = (c: Clip, m: Media, off: number, len: number) => {
    const src = sourceFilters(m, c.picture);
    const pic = c.picture, blur = pic?.fit === 'fit' && pic.bars === 'blur';
    return [
      ...(c.speed !== 1 ? [`setpts=PTS/${n(c.speed, 5)}`] : []),
      ...src.filters,
      ...(blur ? [blurFitFilters(src.size, W, H, pic.rotate, String(++tags))]
        : pic?.fit === 'fit' ? fitFilters(src.size, W, H, true) : framingFilters(src.size, shiftKf(c.transform, off), W, H)),
      // turned about the frame centre; the corners show black, like a rotated clip in any editor (on blurred bars only the picture turns)
      ...(pic?.rotate && !blur ? [`rotate=${radians(pic.rotate)}:ow=${W}:oh=${H}:c=black`] : []),
      ...gradeFilters(gradeOf(c), opts.lutFile, String(++tags)),
      ...mainPlace(c, off),
      ...opacityFilters(shiftKeys(c.anim?.opacity, off), pic?.opacity ?? 1, len, ['rr', 'gg', 'bb']),
      `fps=${fps}`,
      'setsar=1',
      'format=yuv420p',
    ];
  };
  /** the clip's volume, or its volume keys as an expression of the piece's time (it starts `off` seconds into the clip) */
  const volumeFilter = (c: Clip, off = 0): string[] => c.anim?.volume?.length
    ? [`volume='${keyExpr(shiftKeys(c.anim.volume, off), c.volume)}':eval=frame`]
    : c.volume !== 1 ? [`volume=${n(c.volume, 3)}`] : [];
  const audioChain = (c: Clip, off = 0) => ['aresample=48000', 'aformat=channel_layouts=stereo', ...denoiseFilters(c.denoise), ...atempoChain(c.speed), ...volumeFilter(c, off)];
  const push = (clipId: string, args: string[], outDur: number, files: (string | undefined)[]) => {
    // the cache key is the exact ffmpeg command plus the input files' identity, so any change
    // in what we ask ffmpeg to do (including compiler fixes) re-renders the segment
    const key = [SEGMENT_VERSION, args, ...files.map((f) => (f ? opts.fileKey(f) : ''))];
    const hash = createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16);
    const output = `cache/segments/${hash}.mov`;
    segments.push({ clipId, hash, output, duration: outDur, args: [...args, output] });
  };
  const encode = [...videoCodec(opts.quality, opts.nvenc, 'segment'), '-g', String(fps * 2), '-c:a', 'pcm_s16le'];
  /** the picture of a sound-only main clip: black at the output size */
  const blackInput = (len: number) => ['-f', 'lavfi', '-t', n(len), '-i', `color=c=black:s=${W}x${H}:r=${fps}`];

  const padBlack = (from: number, to: number, onlyPicture = false) => {
    const frames = Math.max(onlyPicture && to > from ? 1 : 0, frameAt(to) - frameAt(from));
    if (!frames) return;
    const len = frames / fps;
    push(`black:${frameAt(from)}`, [...blackInput(len), '-f', 'lavfi', '-t', n(len), '-i', 'anullsrc=r=48000:cl=stereo',
      '-filter_complex', '[0:v]setsar=1,format=yuv420p[v];[1:a]anull[a]', '-map', '[v]', '-map', '[a]', '-t', n(len), ...encode], len, []);
  };

  main.forEach((c, i) => {
    padBlack(i ? clipEnd(main[i - 1]) : 0, c.start);
    const m = media.get(c.mediaId!)!;
    const src = srcOf(m);
    // the clip minus the halves its transitions use (a clip without transitions is the whole clip)
    const head = half[i], tail = half[i + 1] ?? 0;
    const frames = Math.max(1, frameAt(clipEnd(c) - tail) - frameAt(c.start + head));
    const outDur = frames / fps;
    const srcDur = outDur * c.speed;
    const grade = gradeOf(c);
    const isImage = m.kind === 'image', isAudio = m.kind === 'audio' || !!c.picture?.off;
    // a sound-only clip on the main track (a podcast, a voice-over) plays over black
    const vf = isAudio ? [`fps=${fps}`, 'setsar=1', 'format=yuv420p'] : videoChain(c, m, head, outDur);
    // click-free audio at real cuts (or the clip's own fades); across a transition the sound runs on, so no fade there
    const fin = Math.min(outDur, Math.max(fade, c.fadeIn ?? 0)), fout = Math.min(outDur, Math.max(fade, c.fadeOut ?? 0));
    const af = [
      ...audioChain(c, head),
      ...(head ? [] : [`afade=t=in:d=${n(fin)}`]),
      'apad',
      ...(tail ? [] : [`afade=t=out:st=${n(Math.max(0, outDur - fout))}:d=${n(fout)}`]),
    ];
    // NVDEC decodes the source on the GPU (10-bit HEVC 2K is the slow part on CPU);
    // ffmpeg falls back to software decoding by itself when it can't
    const inputs = isImage
      ? ['-loop', '1', '-framerate', String(fps), '-t', n(outDur), '-i', src]
      : [...(opts.nvenc && !isAudio ? ['-hwaccel', 'cuda'] : []), '-ss', n(c.in + head * c.speed), '-t', n(srcDur + 2 / fps), '-i', src];
    if (isAudio) inputs.push(...blackInput(outDur));
    const hasAudio = hasAudioOf(c, m);
    if (!hasAudio) inputs.push('-f', 'lavfi', '-t', n(outDur), '-i', 'anullsrc=r=48000:cl=stereo');
    const args = [
      ...inputs,
      '-filter_complex', `[${isAudio ? 1 : 0}:v]${vf.join(',')}[v];[${hasAudio ? 0 : isAudio ? 2 : 1}:a]${af.join(',')}[a]`,
      '-map', '[v]', '-map', '[a]',
      '-t', n(outDur),
      ...encode,
    ];
    push(c.id, args, outDur, [src, grade?.lut]);
    if (tail) pushTransition(main[i], main[i + 1], tail);
  });

  /** The blend across the cut A|B: A runs on past its out-point, B starts before its in-point. Sound cuts at the cut, as without a transition. */
  function pushTransition(a: Clip, b: Clip, h: number) {
    const ma = media.get(a.mediaId!)!, mb = media.get(b.mediaId!)!;
    const cut = b.start;
    const frames = Math.max(1, frameAt(cut + h) - frameAt(cut - h));
    const outDur = frames / fps;
    const dA = (frameAt(cut) - frameAt(cut - h)) / fps, dB = outDur - dA;
    const pad = n(outDur + 2 / fps); // inputs a little longer than the blend: xfade needs both to last it
    const inputs: string[] = [];
    let k = 0;
    /** the media's input index, and where its picture comes from (black beside a sound-only media) */
    const input = (m: Media, c: Clip, ss: number, len: number) => {
      if (m.kind === 'image') inputs.push('-loop', '1', '-framerate', String(fps), '-t', pad, '-i', srcOf(m));
      else inputs.push(...(opts.nvenc && m.kind !== 'audio' ? ['-hwaccel', 'cuda'] : []), '-ss', n(ss), '-t', n(len + 2 / fps), '-i', srcOf(m));
      const i = k++;
      if (m.kind !== 'audio' && !c.picture?.off) return { i, v: i };
      inputs.push(...blackInput(outDur + 2 / fps));
      return { i, v: k++ };
    };
    const ssA = Math.max(0, a.out - h * a.speed);
    const { i: ia, v: iva } = input(ma, a, ssA, 2 * h * a.speed);
    const wantB = b.in - h * b.speed, ssB = Math.max(0, wantB);
    const { i: ib, v: ivb } = input(mb, b, ssB, 2 * h * b.speed);
    const preB = (ssB - wantB) / b.speed; // B's media starts too late: hold its first frame
    const fit = (extra: string[]) => [...extra, `tpad=stop_mode=clone:stop_duration=${pad}`, `trim=duration=${pad}`, 'setpts=PTS-STARTPTS'];
    const plain = [`fps=${fps}`, 'setsar=1', 'format=yuv420p'];
    const va = [...(ma.kind === 'audio' || a.picture?.off ? plain : videoChain(a, ma, clipDuration(a) - h, outDur)), ...fit([])];
    const vb = [...(mb.kind === 'audio' || b.picture?.off ? plain : videoChain(b, mb, -h, outDur)), ...fit(preB > 1e-3 ? [`tpad=start_mode=clone:start_duration=${n(preB)}`] : [])];
    const XFADE: Record<NonNullable<Clip['transition']>['kind'], string> = {
      crossfade: 'fade', dip: 'fadeblack', flash: 'fadewhite', slide: 'slideleft', zoom: 'zoomin', blur: 'hblur', wipe: 'wipeleft',
    };
    const graph = [
      `[${iva}:v]${va.join(',')}[va]`,
      `[${ivb}:v]${vb.join(',')}[vb]`,
      // xfade may pick another pixel format (yuv444p); every segment must match or the concat in the final pass stalls
      `[va][vb]xfade=transition=${XFADE[b.transition!.kind]}:duration=${n(outDur)}:offset=0,format=yuv420p[v]`,
    ];
    // sound: A up to the cut, then B from its in-point, with the usual click-free join
    const sound = (c: Clip, m: Media, i: number, from: number, len: number, edge: 'in' | 'out', label: string, off: number) => {
      if (!hasAudioOf(c, m)) {
        inputs.push('-f', 'lavfi', '-t', n(len), '-i', 'anullsrc=r=48000:cl=stereo');
        graph.push(`[${k++}:a]atrim=duration=${n(len)}[${label}]`);
        return;
      }
      const fadeF = edge === 'out' ? `afade=t=out:st=${n(Math.max(0, len - fade))}:d=${n(fade)}` : `afade=t=in:d=${n(fade)}`;
      graph.push(`[${i}:a]atrim=start=${n(from)}:duration=${n(len * c.speed)},asetpts=PTS-STARTPTS,${audioChain(c, off).join(',')},apad,atrim=duration=${n(len)},${fadeF}[${label}]`);
    };
    sound(a, ma, ia, 0, dA, 'out', 'aa', clipDuration(a) - h);
    sound(b, mb, ib, b.in - ssB, dB, 'in', 'ab', 0);
    graph.push('[aa][ab]concat=n=2:v=0:a=1[a]');
    const args = [...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-map', '[a]', '-t', n(outDur), ...encode];
    push(`${b.id}:in`, args, outDur, [srcOf(ma), srcOf(mb), gradeOf(a)?.lut, gradeOf(b)?.lut]);
  }

  padBlack(main.length ? clipEnd(main[main.length - 1]) : 0, projectDuration(p), !main.length);
  const duration = segments.reduce((s, x) => s + x.duration, 0);
  const concatList = {
    path: `cache/concat-${opts.quality}.txt`,
    body: segments.map((s) => `file '${s.output.replace(/^cache\//, '')}'`).join('\n') + '\n',
  };

  // ---- final pass: overlays, text, music, loudness
  const finalInputs: string[] = [...(opts.nvenc ? ['-hwaccel', 'cuda'] : []), '-f', 'concat', '-safe', '0', '-i', concatList.path];
  const vSteps: string[] = [];
  const aSteps: string[] = [];
  let vLabel = '0:v';
  let idx = 1;
  const visible = (trackId: string) => !p.tracks.find((t) => t.id === trackId)?.hidden;
  const audible = (trackId: string) => !p.tracks.find((t) => t.id === trackId)?.muted;

  const isStatic = (c: Clip) => (c.textStyle?.animation ?? 'fade') === 'none';
  const streamed = new Set<string>();
  /** text track -> its caption stream, overlaid when the compositor reaches that track */
  const streams = new Map<string, string>();
  if (opts.blankImage) {
    // captions are many short, unanimated images: chain them into a single image stream
    for (const track of p.tracks.filter((t) => t.kind === 'text' && visible(t.id))) {
      const clips = p.clips
        .filter((c) => c.trackId === track.id && c.text && isStatic(c) && c.start < duration && opts.textImage?.(c))
        .sort((a, b) => a.start - b.start)
        .filter((c, i, arr) => i === 0 || c.start >= clipEnd(arr[i - 1]) - 1e-3);
      if (clips.length < 2) continue;
      const rel = (f: string) => `file '${f.replace(/^cache\//, '')}'`;
      const lines: string[] = [];
      let t = 0;
      for (const c of clips) {
        if (c.start - t > 1e-3) lines.push(rel(opts.blankImage), `duration ${n(c.start - t)}`);
        const end = Math.min(clipEnd(c), duration);
        lines.push(rel(opts.textImage!(c)!), `duration ${n(end - c.start)}`);
        t = end;
        streamed.add(c.id);
      }
      if (duration - t > 1e-3) lines.push(rel(opts.blankImage), `duration ${n(duration - t)}`);
      lines.push(rel(opts.blankImage)); // the concat demuxer ignores the last entry's duration
      const path = `cache/textstream-${track.id}-${opts.quality}.txt`;
      files.push({ path, body: lines.join('\n') + '\n' });
      streams.set(track.id, path);
    }
  }

  // layers stack like the editor preview: b-roll and graphics in track order, then text above all of them;
  // within a track, by start
  const layers = [...p.tracks.filter((t) => t.kind !== 'text'), ...p.tracks.filter((t) => t.kind === 'text')];
  const free = p.clips.filter((c) => c.trackId !== MAIN_TRACK && c.start < duration && !streamed.has(c.id));
  const musicLabels: string[] = [];
  const speechLabels: string[] = [];
  const sfxLabels: string[] = [];
  for (const track of layers) {
    const stream = streams.get(track.id);
    if (stream) {
      finalInputs.push('-f', 'concat', '-safe', '0', '-i', stream);
      vSteps.push(`[${idx}:v]format=rgba,fps=${fps}[ts${idx}]`, `[${vLabel}][ts${idx}]overlay=eof_action=pass:format=auto[vo${idx}]`);
      vLabel = `vo${idx}`;
      idx++;
    }
    for (const c of free.filter((x) => x.trackId === track.id).sort((a, b) => a.start - b.start)) layer(track, c);
  }

  /**
   * A layer's place keys: the overlay position as expressions of the timeline t (keys count from the clip start), and
   * a size that changes frame by frame, padded to its largest so the overlay always gets frames of one size.
   * `w`×`h` is the layer before its place scale.
   */
  function motion(c: Clip, w: number, h: number) {
    const a = c.anim, pl = c.place, tv = `(t-${n(c.start)})`;
    const at = (keys: Key[] | undefined, base: number, size: number) => (keys?.length ? `(${keyExpr(keys, base, tv)})*${size}` : n(base * size, 2));
    let grow: string[] | undefined;
    if (a?.scale?.length) {
      const max = Math.max(...a.scale.map((k) => k.v)), s = keyExpr(a.scale, pl?.scale ?? 1);
      grow = [
        `scale=w='max(2,2*trunc(iw*(${s})/2))':h='max(2,2*trunc(ih*(${s})/2))':eval=frame`,
        `pad=w=${Math.ceil((w * max) / 2) * 2 + 2}:h=${Math.ceil((h * max) / 2) * 2 + 2}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`,
      ];
    }
    // scaled about the anchor: a shift of (anchor − ½)·(1 − scale) frames
    const s = a?.scale?.length ? `(${keyExpr(a.scale, pl?.scale ?? 1, tv)})` : n(pl?.scale ?? 1);
    const lean = (k: number, size: number) => (Math.abs(k - 0.5) < 1e-6 ? '' : `+(${n(k - 0.5)})*${size}*(1-${s})`);
    return { grow, x: `(main_w-overlay_w)/2+${at(a?.dx, pl?.dx ?? 0, W)}${lean(pl?.ax ?? 0.5, W)}`, y: `(main_h-overlay_h)/2+${at(a?.dy, pl?.dy ?? 0, H)}${lean(pl?.ay ?? 0.5, H)}` };
  }
  function moves(c: Clip) {
    return !!(c.anim?.dx?.length || c.anim?.dy?.length || c.anim?.scale?.length);
  }

  function layer(track: Track, c: Clip) {
    const start = c.start, end = Math.min(clipEnd(c), duration);
    const m = c.mediaId ? media.get(c.mediaId) : undefined;

    if (c.graphic) {
      const g = track.kind !== 'audio' && visible(track.id) ? opts.graphicVideo?.(c) : undefined;
      if (!g) return;
      finalInputs.push('-t', n(end - start), '-i', g);
      const separateAlpha = g.endsWith('.rgba.mkv');
      if (separateAlpha) vSteps.push(`[${idx}:v:0]fps=${fps}[gc${idx}];[${idx}:v:1]fps=${fps},format=gray[ga${idx}];[gc${idx}][ga${idx}]alphamerge[gr${idx}]`);
      // moved / resized by the user: scale the layer about the frame centre, then shift it (over time, with keys)
      const pl = moves(c) ? undefined : placeFilter(c.place, W, H), mo = moves(c) ? motion(c, W, H) : undefined;
      const chain = ['format=rgba', ...(mo?.grow ?? (pl?.scale ? [pl.scale] : [])), ...opacityFilters(c.anim?.opacity, c.picture?.opacity ?? 1, end - start, ['aa']), `setpts=PTS-STARTPTS+${n(start)}/TB`];
      const at = mo ?? pl;
      vSteps.push(
        `[${separateAlpha ? `gr${idx}` : `${idx}:v`}]${chain.join(',')}[gx${idx}]`,
        `[${vLabel}][gx${idx}]overlay=${at ? `x='${at.x}':y='${at.y}':` : ''}eof_action=pass:format=auto:enable='between(t,${n(start)},${n(end)})'[vo${idx}]`,
      );
      vLabel = `vo${idx}`;
      idx++;
    } else if (track.kind === 'overlay' && c.picture?.off && m && hasAudioOf(c, m) && audible(track.id)) {
      finalInputs.push('-ss', n(c.in), '-t', n(c.out - c.in), '-i', m.path);
      const len = end - start;
      const fin = Math.min(len, Math.max(fade, c.fadeIn ?? 0)), fout = Math.min(len, Math.max(fade, c.fadeOut ?? 0));
      aSteps.push(`[${idx}:a]${[...audioChain(c), `atrim=duration=${n(len)}`, `afade=t=in:d=${n(fin)}`, `afade=t=out:st=${n(Math.max(0, len - fout))}:d=${n(fout)}`, `adelay=${Math.round(start * 1000)}:all=1`].join(',')}[oa${idx}]`);
      speechLabels.push(`oa${idx}`);
      idx++;
    } else if (track.kind === 'overlay' && !c.picture?.off && m && visible(track.id) && m.kind !== 'audio') {
      const src = preview && m.proxy ? m.proxy : m.path;
      finalInputs.push(...(m.kind === 'image' ? ['-loop', '1', '-framerate', String(fps), '-t', n(end - start)] : ['-ss', n(c.in), '-t', n(c.out - c.in)]), '-i', src);
      // crop/flip → fill (or fit) the frame → size (picture-in-picture) → rotate → opacity, then placed about the centre
      const pic = c.picture, srcf = sourceFilters(m, pic);
      const scale = c.place?.scale ?? 1, rot = pic?.rotate ?? 0, opacity = pic?.opacity ?? 1;
      // the layer's size before its place scale (filling the frame, or fitted), turned: what a growing scale works on
      const base = pic?.fit === 'fit' ? fitSize(srcf.size, W, H) : { width: W, height: H }, r = (rot * Math.PI) / 180;
      const mo = motion(c, Math.ceil(Math.abs(base.width * Math.cos(r)) + Math.abs(base.height * Math.sin(r))), Math.ceil(Math.abs(base.width * Math.sin(r)) + Math.abs(base.height * Math.cos(r))));
      const seeThrough = !!c.anim?.opacity?.length || opacity < 1;
      const chain = [
        ...(c.speed !== 1 ? [`setpts=PTS/${n(c.speed, 5)}`] : []),
        ...srcf.filters,
        ...(pic?.fit === 'fit' ? fitFilters(srcf.size, W, H, false) : framingFilters(srcf.size, c.transform, W, H)),
        ...gradeFilters(c.grade ?? p.settings.defaultGrade, opts.lutFile),
        ...(scale !== 1 && !mo.grow ? [`scale=w=trunc(iw*${n(scale)}/2)*2:h=trunc(ih*${n(scale)}/2)*2`] : []),
        `fps=${fps}`,
        ...(rot || seeThrough || mo.grow ? ['format=rgba'] : []),
        ...(rot ? [`rotate=${radians(rot)}:ow='rotw(${radians(rot)})':oh='roth(${radians(rot)})':c=none`] : []),
        ...(mo.grow ?? []),
        ...opacityFilters(c.anim?.opacity, opacity, end - start, ['aa']),
        'format=yuva420p',
        `setpts=PTS-STARTPTS+${n(start)}/TB`,
      ];
      vSteps.push(`[${idx}:v]${chain.join(',')}[ov${idx}]`, `[${vLabel}][ov${idx}]overlay=x='${mo.x}':y='${mo.y}':eof_action=pass:enable='between(t,${n(start)},${n(end)})'[vo${idx}]`);
      vLabel = `vo${idx}`;
      if (hasAudioOf(c, m) && audible(track.id)) {
        // same speed as the picture, cut to the clip and click-free at both ends (or the clip's own fades)
        const len = end - start;
        const fin = Math.min(len, Math.max(fade, c.fadeIn ?? 0)), fout = Math.min(len, Math.max(fade, c.fadeOut ?? 0));
        aSteps.push(`[${idx}:a]${[...audioChain(c), `atrim=duration=${n(len)}`, `afade=t=in:d=${n(fin)}`, `afade=t=out:st=${n(Math.max(0, len - fout))}:d=${n(fout)}`, `adelay=${Math.round(start * 1000)}:all=1`].join(',')}[oa${idx}]`);
        musicLabels.push(`oa${idx}`);
      }
      idx++;
    } else if (track.kind === 'text' && visible(track.id) && c.text) {
      const img = opts.textImage?.(c);
      if (!img) return;
      finalInputs.push('-loop', '1', '-framerate', String(fps), '-t', n(end - start), '-i', img);
      const anim = c.textStyle?.animation ?? 'fade';
      const d = Math.min(0.35, (end - start) / 3);
      const chain = ['format=rgba'];
      if (anim !== 'none') chain.push(`fade=t=in:st=0:d=${n(d)}:alpha=1`, `fade=t=out:st=${n(end - start - d)}:d=${n(d)}:alpha=1`);
      if (anim === 'pop') {
        // grows from 92% about the frame centre, like the editor preview; padded back to full frame
        const s = `(0.92+0.08*min(1,t/${n(d)}))`;
        chain.push(`scale=w='trunc(iw*${s})':h='trunc(ih*${s})':eval=frame`, `pad=w=${W}:h=${H}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`);
      }
      chain.push(`setpts=PTS-STARTPTS+${n(start)}/TB`);
      // slide-up moves the layer; the PNG is full-frame so position comes from its pixels
      const y = anim === 'slide-up' ? `'max(0,(1-(t-${n(start)})/${n(d)}))*${Math.round(H * 0.04)}'` : '0';
      vSteps.push(`[${idx}:v]${chain.join(',')}[tx${idx}]`, `[${vLabel}][tx${idx}]overlay=x=0:y=${y}:eof_action=pass:enable='between(t,${n(start)},${n(end)})'[vo${idx}]`);
      vLabel = `vo${idx}`;
      idx++;
    } else if (track.kind === 'audio' && m && m.hasAudio && audible(track.id) && m.role === 'sfx') {
      // sound effects: no fades (they would eat the attack), and mixed after the ducking below
      finalInputs.push('-ss', n(c.in), '-t', n(c.out - c.in), '-i', m.path);
      aSteps.push(`[${idx}:a]${['aresample=48000', 'aformat=channel_layouts=stereo', ...atempoChain(c.speed), ...volumeFilter(c)].join(',')},adelay=${Math.round(start * 1000)}:all=1[sx${idx}]`);
      sfxLabels.push(`sx${idx}`);
      idx++;
    } else if (track.kind === 'audio' && m && m.hasAudio && audible(track.id)) {
      finalInputs.push('-ss', n(c.in), '-t', n(c.out - c.in), '-i', m.path);
      const voice = track.audio === 'voice';
      const f = voice ? 0 : Math.min(1, (end - start) / 4), len = end - start;
      const fin = Math.min(len, Math.max(voice ? 0 : fade, c.fadeIn ?? f)), fout = Math.min(len, Math.max(voice ? 0 : fade, c.fadeOut ?? f));
      const label = `${voice ? 'va' : 'ma'}${idx}`;
      aSteps.push(
        `[${idx}:a]${[...audioChain(c), `atrim=duration=${n(len)}`, ...(fin ? [`afade=t=in:d=${n(fin)}`] : []), ...(fout ? [`afade=t=out:st=${n(Math.max(0, len - fout))}:d=${n(fout)}`] : []), `adelay=${Math.round(start * 1000)}:all=1`].join(',')}[${label}]`,
      );
      (voice ? speechLabels : musicLabels).push(label);
      idx++;
    }
  }

  // Loudness in two steps: a quick sound-only pass measures the whole mix (loudnorm), then the final pass turns it up or
  // down by that one fixed gain and a limiter catches the peaks. loudnorm's own one-pass (dynamic) mode would raise every
  // quiet part — fade-outs, lowered music, volume keys — back up.
  const loud = '{{loudness}}';
  // loudnorm's <3s startup path can multiply digital silence by infinite gain (NaN).
  // Supply its full analysis window without inventing noise; -t keeps the edit's duration.
  // whole_dur leaves streams already >=3s unchanged and also covers silent *present* audio tracks.
  const measureStep = `apad=whole_dur=3,loudnorm=I=${p.settings.loudness}:TP=-1.5:LRA=11:print_format=json`;
  const gainStep = `volume=${LOUDNESS_GAIN}dB,alimiter=limit=0.841:level=false:latency=1,aresample=48000`; // −1.5 dBFS
  const mainMuted = !audible(MAIN_TRACK);
  // the last step: sound effects on top of voice + music, then loudness
  const finish = (from: string, chain: string) =>
    sfxLabels.length
      ? [`${from}${chain ? `${chain},` : ''}anull[premix]`, `[premix][${sfxLabels.join('][')}]amix=inputs=${sfxLabels.length + 1}:normalize=0:duration=first,${loud}[aout]`]
      : [`${from}${chain ? `${chain},` : ''}${loud}[aout]`];
  let voiceSource = '[0:a]';
  if (speechLabels.length) {
    aSteps.push(`[0:a]${mainMuted ? 'volume=0,' : ''}anull[mainvoice]`, `[mainvoice][${speechLabels.join('][')}]amix=inputs=${speechLabels.length + 1}:normalize=0:duration=first[speech]`);
    voiceSource = '[speech]';
  }
  if (mainMuted && !musicLabels.length && !sfxLabels.length && !speechLabels.length) {
    aSteps.push('[0:a]volume=0[aout]');
  } else if (musicLabels.length) {
    aSteps.push(`${voiceSource}${mainMuted && !speechLabels.length ? 'volume=0,' : ''}asplit=2[voice][key]`,
      `[${musicLabels.join('][')}]amix=inputs=${musicLabels.length}:normalize=0[bed]`,
      `[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]`,
      ...finish('[voice][ducked]', 'amix=inputs=2:normalize=0:duration=first'),
    );
  } else {
    aSteps.push(...finish(voiceSource, mainMuted && !speechLabels.length ? 'volume=0' : ''));
  }

  const audioOnly = opts.audio !== undefined;
  const output = opts.output ?? `renders/${p.name}-${opts.quality}.${opts.audio ?? 'mp4'}`;
  const range = opts.range && (opts.range[0] > 0.0005 || opts.range[1] < duration - 0.0005) ? opts.range : undefined;
  // the segments are already H.264 at about this quality: reuse them unless the export asks otherwise
  const copyVideo = vSteps.length === 0 && !range && (opts.codec ?? 'h264') === 'h264' && opts.level !== 'small';
  const sound = aSteps.join(';');
  const graph = [...(audioOnly ? [] : vSteps), sound.replace(loud, gainStep)].join(';');
  const measure = sound.includes(loud)
    ? { target: p.settings.loudness, args: [...finalInputs, '-filter_complex', sound.replace(loud, measureStep), '-map', '[aout]', '-t', n(duration), '-f', 'null', '-'] }
    : undefined;
  const final: FfmpegJob = {
    output,
    duration: range ? range[1] - range[0] : duration,
    args: [
      ...finalInputs,
      '-filter_complex', graph,
      ...(audioOnly
        ? ['-map', '[aout]', '-vn', ...(opts.audio === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '320k'])]
        : [
          '-map', copyVideo ? '0:v' : `[${vLabel}]`,
          '-map', '[aout]',
          ...(copyVideo ? ['-c:v', 'copy'] : [...videoCodec(opts.quality, opts.nvenc, 'final', opts.codec, opts.level), '-pix_fmt', 'yuv420p', '-r', String(fps)]),
          '-c:a', 'aac', '-b:a', preview || opts.level === 'small' ? '160k' : '320k',
        ]),
      // a part of the timeline: cut after the filters, so overlays, fades and loudness match the full edit
      ...(range ? ['-ss', n(range[0]), '-t', n(range[1] - range[0])] : ['-t', n(duration)]),
      ...(audioOnly ? [] : ['-movflags', '+faststart']),
      output,
    ],
  };

  return { width: W, height: H, fps, duration: final.duration, segments, concatList, files, measure, final };
}
