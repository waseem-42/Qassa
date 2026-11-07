import { spawn, spawnSync } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FFMPEG } from '@edit/render';
import { OpError } from '@edit/shared';
import { queueAnalysis } from './media.ts';
import type { Jobs } from './jobs.ts';
import type { Store } from './store.ts';

// A recording with several audio tracks (OBS: mic, desktop, music…): the editor, the waveform, the analysis and the
// render all read a file's first audio track. So the file gets a first track that mixes the chosen ones, titled
// MIX, and keeps every original track after it (nothing is lost; the mix can be redone with other tracks).

const MIX = 'qassa-mix';

export interface AudioTracks { /** the original tracks, in file order */ tracks: { channels: number; title?: string; language?: string }[]; /** originals in the mix (0-based) */ mix: number[]; mixed: boolean }

export function probeAudioTracks(abs: string): AudioTracks {
  const r = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=channels:stream_tags=title,handler_name,language', '-of', 'json', abs], { encoding: 'utf8', windowsHide: true });
  const streams: { channels?: number; tags?: { title?: string; handler_name?: string; language?: string } }[] = r.status === 0 ? JSON.parse(r.stdout).streams ?? [] : [];
  // MP4 keeps a track's name as its handler name; MKV/MOV as its title
  const label = (s?: (typeof streams)[number]) => [s?.tags?.title, s?.tags?.handler_name].find((v) => v?.startsWith(MIX));
  const mixed = !!label(streams[0]);
  const tracks = (mixed ? streams.slice(1) : streams).map((s) => ({ channels: s.channels ?? 2, ...(s.tags?.title ? { title: s.tags.title } : {}), ...(s.tags?.language && s.tags.language !== 'und' ? { language: s.tags.language } : {}) }));
  const mix = mixed ? label(streams[0])!.slice(MIX.length + 1).split(',').filter((s) => s !== '').map(Number).filter((i) => i >= 0 && i < tracks.length) : [0];
  return { tracks, mix, mixed };
}

/** Rewrite the file with a first track mixing `pick` (originals, 0-based) and every original after it; the picture is copied. */
export async function mixAudioTracks(abs: string, pick: number[], signal?: AbortSignal): Promise<void> {
  const { tracks, mixed } = probeAudioTracks(abs);
  if (tracks.length < 2) throw new OpError('هذا الملف فيه مسار صوت واحد');
  const chosen = [...new Set(pick)].filter((i) => i >= 0 && i < tracks.length).sort((a, b) => a - b);
  const src = (i: number) => `[0:a:${mixed ? i + 1 : i}]`;
  // the chosen tracks summed (not averaged, so each keeps its level), kept from clipping; none chosen: silence
  const graph = chosen.length > 1 ? `${chosen.map(src).join('')}amix=inputs=${chosen.length}:normalize=0:duration=longest,alimiter=limit=0.95:level=false[mix]`
    : chosen.length ? `${src(chosen[0])}anull[mix]` : `${src(0)}volume=0[mix]`;
  const ext = extname(abs), tmp = `${abs}.mix${ext}`;
  const args = ['-v', 'error', '-y', '-i', abs, '-filter_complex', graph, '-map', '0:v?', '-map', '[mix]',
    ...tracks.flatMap((_, i) => ['-map', `0:a:${mixed ? i + 1 : i}`]),
    '-map_metadata', '0', '-c:v', 'copy', '-c:a', 'copy', '-c:a:0', ext.toLowerCase() === '.webm' ? 'libopus' : 'aac', '-b:a:0', '256k',
    '-metadata:s:a:0', `title=${MIX}:${chosen.join(',')}`, '-metadata:s:a:0', `handler_name=${MIX}:${chosen.join(',')}`, '-disposition:a:0', 'default', ...tracks.flatMap((_, i) => [`-disposition:a:${i + 1}`, '0']),
    ...(/\.(mp4|mov|m4v)$/i.test(ext) ? ['-movflags', '+faststart'] : []), tmp];
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    const stop = () => ff.kill();
    signal?.addEventListener('abort', stop, { once: true });
    ff.on('error', reject);
    ff.on('close', (code) => { signal?.removeEventListener('abort', stop); code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited ${code}`)); });
  }).catch((e) => { rmSync(tmp, { force: true }); throw e; });
  // the old file may still be open for a moment (a preview request): retry the swap briefly
  for (let i = 0; ; i++) {
    try { renameSync(tmp, abs); return; } catch (e) {
      if (i >= 20) { rmSync(tmp, { force: true }); throw e; }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** Mix the chosen tracks into the project file, then redo what reads its sound (proxy, waveform, silences). */
export function queueAudioMix(store: Store, jobs: Jobs, name: string, mediaId: string, pick: number[] | 'all', opts: { analyze?: boolean; fresh?: boolean } = {}) {
  const media = store.get(name).project.media.find((m) => m.id === mediaId);
  if (!media) throw new OpError(`media ${mediaId} not found`);
  if (isAbsolute(media.path)) throw new OpError('الملف مرتبط من مكانه الأصلي؛ استورده داخل المشروع لتغيير مسارات صوته');
  const abs = join(store.dir(name), media.path);
  return jobs.add('analyze', name, `دمج مسارات صوت ${media.name}`, async (ctx) => {
    ctx.update({ stage: 'audio', message: 'يدمج مسارات الصوت', progress: 0.1 });
    const tracks = pick === 'all' ? probeAudioTracks(abs).tracks.map((_, i) => i) : pick;
    await mixAudioTracks(abs, tracks, ctx.signal);
    const info = probeAudioTracks(abs);
    store.mutate(name, (p) => { const m = p.media.find((x) => x.id === mediaId); if (m) { m.audioTracks = { count: info.tracks.length, mix: info.mix }; m.hasAudio = true; } });
    const m = store.get(name).project.media.find((x) => x.id === mediaId)!;
    const redo = ['probe', 'proxy', 'peaks', ...(m.analyzed.includes('silence') ? ['silence'] : [])];
    // a new import gets its whole first analysis; a re-mix only redoes what reads the sound
    if (opts.analyze !== false) try { queueAnalysis(store, jobs, name, mediaId, opts.fresh ? undefined : redo); } catch { /* analysis tools not set up yet: the mix still plays and exports */ }
    return { mediaId, mix: info.mix };
  }, { mediaId });
}

export function registerAudioTracks(app: FastifyInstance, store: Store, jobs: Jobs) {
  app.get<{ Params: { name: string; id: string } }>('/api/projects/:name/media/:id/audio-tracks', async (req) => {
    const m = store.get(req.params.name).project.media.find((x) => x.id === req.params.id);
    if (!m) throw new OpError('media not found');
    const abs = isAbsolute(m.path) ? m.path : join(store.dir(req.params.name), m.path);
    return existsSync(abs) ? probeAudioTracks(abs) : { tracks: [], mix: [], mixed: false };
  });
  app.post<{ Params: { name: string; id: string }; Body: unknown }>('/api/projects/:name/media/:id/audio-tracks', async (req) => {
    const { mix } = z.object({ mix: z.array(z.number().int().min(0)).max(64) }).parse(req.body);
    return { job: queueAudioMix(store, jobs, req.params.name, req.params.id, mix) };
  });
}
