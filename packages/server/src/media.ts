import { spawnSync } from 'node:child_process';
import { analysisReady, requireAnalysis } from './runtime-setup.ts';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path';
import { MAIN_TRACK, guessedRole, mediaPlacementOps, makeId, mainClips, OpError, type Media, type MediaTarget, type Suggestion } from '@edit/shared';
import { ANALYSIS_DIR, LANGUAGE, PYTHON, WHISPER_MODEL } from './config.ts';
import { runPython, type Jobs } from './jobs.ts';
import { imageProxy } from './image-proxy.ts';
import { probeAudioTracks, queueAudioMix } from './audio-tracks.ts';
import { projectDir, type Store } from './store.ts';

export function ffprobe(file: string): Pick<Media, 'kind' | 'duration' | 'width' | 'height' | 'fps' | 'hasAudio'> {
  const r = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new OpError(`ffprobe failed for ${basename(file)}: ${r.stderr.trim()}`);
  const data = JSON.parse(r.stdout);
  const v = data.streams.find((s: any) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = data.streams.find((s: any) => s.codec_type === 'audio');
  const [num, den] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const fps = den ? Math.round((num / den) * 1000) / 1000 : 0;
  const duration = Number(data.format?.duration ?? 0);
  // a still: read by an image demuxer (png_pipe, jpeg_pipe, image2…) or without any length.
  // Not by frame rate — recent ffprobe reports 25 fps for a single PNG. An animated GIF has a length: video;
  // a one-frame GIF/AVIF reports a 0.04 s length but a single frame: still an image.
  const format = String(data.format?.format_name ?? '');
  const image = !!v && !a && (format === 'image2' || format.endsWith('_pipe') || !(duration > 0) || Number(v.nb_frames) === 1);
  return {
    kind: image ? 'image' : v ? 'video' : 'audio',
    duration: image ? 5 : Math.round(duration * 1000) / 1000,
    width: v ? Number(v.width) : 0,
    height: v ? Number(v.height) : 0,
    fps,
    hasAudio: !!a,
  };
}

const ROLE_DIR: Record<Media['role'], string> = { source: 'source', ref: 'refs', broll: 'source', music: 'source', graphic: 'graphics', sfx: 'sfx' };

/**
 * Register a file that is already in the project (uploaded) or copy one in from elsewhere.
 * Sources go straight onto the main track unless `place: false`; analysis is queued.
 */
export function addMedia(store: Store, jobs: Jobs, name: string, file: string, role: Media['role'] | undefined, opts: { copy?: boolean; analyze?: boolean; placement?: MediaTarget; place?: boolean; name?: string } = {}): Media {
  const dir = store.dir(name);
  let abs = isAbsolute(file) ? file : join(dir, file);
  if (!existsSync(abs)) throw new OpError(`file not found: ${file}`);
  const info = ffprobe(abs);
  role ??= guessedRole(store.get(name).project, info.kind, opts.placement);
  let rel = relative(dir, abs).replace(/\\/g, '/');
  if (rel.startsWith('..') || isAbsolute(rel)) {
    if (opts.copy !== false) {
      const dest = join(dir, ROLE_DIR[role], basename(abs));
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest)) copyFileSync(abs, dest);
      abs = dest;
      rel = relative(dir, dest).replace(/\\/g, '/');
    } else {
      rel = abs.replace(/\\/g, '/'); // referenced in place
    }
  }
  const existing = store.get(name).project.media.find((m) => m.path === rel);
  if (existing) return existing;

  const media: Media = {
    id: makeId('m'),
    path: rel,
    role,
    name: opts.name ?? basename(abs, extname(abs)),
    analyzed: [],
    ...info,
  };
  const proxy = imageProxy(dir, media);
  if (proxy) media.proxy = proxy;
  // several audio tracks: hear them all (the mix is made in a job; originals stay in the file)
  const audio = media.hasAudio && media.kind !== 'image' ? probeAudioTracks(abs) : undefined;
  const multi = !!audio && audio.tracks.length > 1;
  if (multi) media.audioTracks = { count: audio.tracks.length, mix: audio.mixed ? audio.mix : audio.tracks.map((_, i) => i) };
  const first = role === 'source' && media.kind === 'video' && !store.get(name).project.media.some((m) => m.role === 'source');
  const placement = opts.placement ? mediaPlacementOps(store.get(name).project, media, opts.placement) : undefined;
  store.mutate(name, (p) => {
    p.media.push(media);
    if (first) {
      // the first source sets the project's frame rate and orientation
      if (media.fps >= 23) p.settings.fps = Math.min(60, Math.round(media.fps));
      if (media.height > media.width) p.settings.aspect = '9:16';
    }
  });
  if (placement) {
    store.apply(name, placement, 'user');
  } else if (role === 'source' && opts.place !== false) {
    store.apply(name, [{ op: 'add_clip', clip: { trackId: MAIN_TRACK, mediaId: media.id, in: 0, out: media.duration } }], 'system');
  }
  if (multi && !audio!.mixed && !isAbsolute(rel)) queueAudioMix(store, jobs, name, media.id, 'all', { analyze: opts.analyze !== false && analysisReady(), fresh: true });
  else if (opts.analyze !== false && media.kind !== 'image' && analysisReady()) queueAnalysis(store, jobs, name, media.id);
  return media;
}

export function stepsFor(m: Media): string[] {
  if (m.role === 'ref') return ['probe', 'proxy', 'thumbs', 'shots', 'summary'];
  if (m.role === 'music' || m.role === 'sfx') return ['probe', 'peaks'];
  if (m.kind === 'audio') return ['probe', 'peaks', 'silence', 'summary'];
  if (m.role === 'broll') return ['probe', 'proxy', 'peaks', 'thumbs', 'shots'];
  return ['probe', 'proxy', 'peaks', 'thumbs', 'silence', 'shots', 'summary'];
}

const WEIGHTS: Record<string, number> = { probe: 0.2, proxy: 3, peaks: 0.5, thumbs: 1, transcribe: 6, silence: 1, shots: 1.5, summary: 0.1 };

export function queueAnalysis(store: Store, jobs: Jobs, name: string, mediaId: string, steps?: string[], extra: { prompt?: string; model?: string; reason?: 'assistant' } = {}) {
  requireAnalysis();
  const media = store.get(name).project.media.find((m) => m.id === mediaId);
  if (!media) throw new OpError(`media ${mediaId} not found`);
  const s = steps?.length ? steps : stepsFor(media);
  const existing = jobs.list(name).find((j) => j.kind === 'analyze' && j.mediaId === mediaId && ['queued', 'running'].includes(j.status) && s.every((step) => j.steps?.includes(step)));
  if (existing) return existing;
  const weights = Object.fromEntries(s.map((k) => [k, WEIGHTS[k] ?? 1]));
  return jobs.add('analyze', name, `${s.includes('transcribe') ? 'تفريغ' : 'تحليل'} ${media.name}`, async (ctx) => {
    if (extra.reason === 'assistant' && s.includes('transcribe')) ctx.update({ stage: 'transcribe', message: 'المساعد يحتاج التفريغ — يبدأ الآن' });
    const res = await runPython(
      PYTHON,
      [join(ANALYSIS_DIR, 'analyze.py'), '--project', store.dir(name), '--media-id', mediaId, '--path', media.path, '--name', media.name,
        '--steps', s.join(','), '--model', extra.model ?? WHISPER_MODEL, '--language', LANGUAGE, ...(extra.prompt ? ['--prompt', extra.prompt] : [])],
      ANALYSIS_DIR,
      ctx,
      weights,
    );
    const { suggestions, kind: _kind, ...fields } = res ?? {};
    store.dropTranscript(name, mediaId);
    store.mutate(name, (p) => {
      const m = p.media.find((x) => x.id === mediaId);
      if (!m) return;
      Object.assign(m, fields, { analyzed: [...new Set([...(m.analyzed ?? []), ...(fields.analyzed ?? [])])] });
      // a source that was imported before its duration was known: fit its main clip
      for (const c of mainClips(p)) if (c.mediaId === mediaId && c.out > m.duration && m.duration > 0) c.out = m.duration;
    });
    if (Array.isArray(suggestions)) {
      store.apply(name, [
        { op: 'clear_suggestions', author: 'analysis' },
        ...(suggestions.length ? [{ op: 'add_suggestions' as const, items: suggestions.map((x: Suggestion) => ({ ...x, author: 'analysis' as const })) }] : []),
      ], 'analysis', { history: false });
    }
    return { mediaId, steps: s };
  }, { mediaId, steps: s });
}

export function readAnalysis<T>(name: string, mediaId: string, file: string): T | undefined {
  const f = join(projectDir(name), 'analysis', mediaId, file);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : undefined;
}
