import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { clipDuration, EPS, makeId, OpError, type Clip, type Media } from '@edit/shared';
import { hasNvenc, runJob } from '@edit/render';
import { ffprobe, queueAnalysis } from './media.ts';
import type { Store } from './store.ts';
import type { Jobs } from './jobs.ts';

// Edits that need a new picture file first: a held frame (freeze) and a part played backwards (reverse).
// The file is made with ffmpeg in the project folder, registered as a media that remembers where it came
// from (media.derived), and the clip then uses it through an ordinary op — so undo works as usual.

type P = { Params: { name: string; clipId: string } };
/** prepares a new video for the editor (proxy, waveform, filmstrip) */
type Analyze = (name: string, mediaId: string) => void;

const fileBase = (m: Media) => basename(m.path, extname(m.path)).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'clip';

function find(store: Store, name: string, clipId: string): { clip: Clip; media: Media } {
  const p = store.get(name).project;
  const clip = p.clips.find((c) => c.id === clipId);
  if (!clip) throw new OpError(`clip ${clipId} not found`);
  const media = p.media.find((m) => m.id === clip.mediaId);
  if (!media || media.kind !== 'video') throw new OpError('only a video clip can be frozen or reversed');
  return { clip, media };
}

/** Register a file the editor made from another media; a video gets a proxy, waveform and filmstrip like any other. */
function addDerived(store: Store, analyze: Analyze, name: string, rel: string, from: Media, derived: NonNullable<Media['derived']>, label: string): Media {
  const media: Media = {
    id: makeId('m'), path: rel, role: from.role === 'broll' ? 'broll' : 'source', name: `${from.name} — ${label}`, analyzed: [],
    ...ffprobe(join(store.dir(name), rel)), derived,
  };
  store.mutate(name, (p) => { p.media.push(media); });
  if (media.kind === 'video') analyze(name, media.id);
  return media;
}

/** Seconds of source per backwards piece: ffmpeg's reverse holds every frame of a piece in memory (~0.5 GB here). */
export function reverseChunk(m: Pick<Media, 'width' | 'height' | 'fps'>): number {
  const frame = Math.max(1, m.width * m.height) * 3; // 10-bit 4:2:0 frames, to be safe
  return Math.min(6, Math.max(0.5, 5e8 / (frame * (m.fps || 30))));
}

/** The pieces of [t0, t1] from the end backwards: [start, length] of each, in playing order of the reversed result. */
export function reversePieces(t0: number, t1: number, chunk: number): [number, number][] {
  const out: [number, number][] = [];
  for (let e = t1; e > t0 + 1e-3; e -= chunk) {
    const s = Math.max(t0, e - chunk);
    out.push([Math.round(s * 1000) / 1000, Math.round((e - s) * 1000) / 1000]);
  }
  return out;
}

export function registerClipTools(app: FastifyInstance, store: Store, jobs: Jobs,
  analyze: Analyze = (name, mediaId) => { queueAnalysis(store, jobs, name, mediaId, ['probe', 'proxy', 'peaks', 'thumbs']); }) {
  app.post<P & { Body: { at?: number; duration?: number; author?: string } }>('/api/projects/:name/clips/:clipId/freeze', async (req) => {
    const { name, clipId } = req.params;
    const { clip, media } = find(store, name, clipId);
    const at = req.body?.at ?? clip.start;
    const fps = media.fps || 30;
    const local = Math.min(Math.max(0, at - clip.start), clipDuration(clip));
    // the frame on screen at `at` (the last one, when frozen at the very end)
    const src = Math.min(clip.in + local * clip.speed, clip.out - 1 / fps, media.duration - 1 / fps);
    const p = store.get(name).project;
    let still = p.media.find((m) => m.derived?.kind === 'freeze' && m.derived.mediaId === media.id && Math.abs(m.derived.in - src) < 0.5 / fps);
    if (!still) {
      const rel = `source/edits/${fileBase(media)}-frame-${src.toFixed(3)}.png`;
      const dir = store.dir(name);
      if (!existsSync(join(dir, rel))) {
        await runJob({ args: ['-ss', src.toFixed(3), '-i', media.path, '-frames:v', '1', '-update', '1', '-pix_fmt', 'rgb24', rel], output: rel, duration: 0 }, dir);
      }
      still = addDerived(store, analyze, name, rel, media, { kind: 'freeze', mediaId: media.id, in: src, out: src }, 'تجميد');
    }
    const r = store.apply(name, [{ op: 'freeze_frame', clipId, at, mediaId: still.id, duration: req.body?.duration ?? 2 }], req.body?.author ?? 'user');
    return { media: still, rev: r.rev, project: r.project, history: store.history(name) };
  });

  app.post<P & { Body: { author?: string } }>('/api/projects/:name/clips/:clipId/reverse', async (req) => {
    const { name, clipId } = req.params;
    const author = req.body?.author ?? 'user';
    const { clip, media } = find(store, name, clipId);
    const p = store.get(name).project;
    const swap = (to: Media, d: NonNullable<Media['derived']>) => {
      // reversed time τ is original time d.out − τ, both ways
      const r = store.apply(name, [{ op: 'replace_media', clipId, mediaId: to.id, in: Math.max(0, d.out - clip.out), out: d.out - clip.in }], author);
      return { done: true, reversed: to.derived?.kind === 'reverse', rev: r.rev, project: r.project, history: store.history(name) };
    };
    // a reversed clip goes back to its original
    if (media.derived?.kind === 'reverse') {
      const orig = p.media.find((m) => m.id === media.derived!.mediaId);
      if (!orig) throw new OpError('the original of this reversed clip is gone');
      return swap(orig, media.derived);
    }
    // reversed before (this part or more of it): reuse that file
    const made = p.media.find((m) => m.derived?.kind === 'reverse' && m.derived.mediaId === media.id && m.derived.in <= clip.in + EPS && m.derived.out >= clip.out - EPS);
    if (made) return swap(made, made.derived!);

    const t0 = clip.in, t1 = clip.out;
    const job = jobs.add('reverse', name, `عكس ${media.name}`, async (ctx) => {
      const dir = store.dir(name);
      const hash = createHash('sha1').update(`${media.path}|${t0}|${t1}`).digest('hex').slice(0, 10);
      const rel = `source/edits/${fileBase(media)}-reverse-${t0.toFixed(2)}-${t1.toFixed(2)}.mp4`;
      if (!existsSync(join(dir, rel))) {
        const tmp = `cache/reverse/${hash}`;
        mkdirSync(join(dir, tmp), { recursive: true });
        const nvenc = hasNvenc() && Math.min(media.width, media.height) >= 144; // NVENC refuses tiny frames
        const video = nvenc ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '16', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14'];
        const pieces = reversePieces(t0, t1, reverseChunk(media));
        const total = t1 - t0;
        let done = 0;
        for (const [i, [s, len]] of pieces.entries()) {
          await runJob({
            args: ['-ss', String(s), '-t', String(len), '-i', media.path, '-vf', 'reverse', ...(media.hasAudio ? ['-af', 'areverse', '-c:a', 'pcm_s16le'] : ['-an']),
              ...video, '-pix_fmt', 'yuv420p', '-g', String(Math.round(media.fps || 30)), `${tmp}/p${i}.mov`],
            output: `${tmp}/p${i}.mov`, duration: len,
          }, dir, (x) => ctx.update({ stage: 'reverse', progress: 0.9 * (done + x * len) / total, message: `${i + 1}/${pieces.length}` }), ctx.signal);
          done += len;
        }
        writeFileSync(join(dir, tmp, 'list.txt'), pieces.map((_, i) => `file 'p${i}.mov'`).join('\n') + '\n');
        await runJob({
          args: ['-f', 'concat', '-safe', '0', '-i', `${tmp}/list.txt`, '-c:v', 'copy', ...(media.hasAudio ? ['-c:a', 'aac', '-b:a', '320k'] : []), '-movflags', '+faststart', rel],
          output: rel, duration: total,
        }, dir, (x) => ctx.update({ stage: 'join', progress: 0.9 + 0.1 * x }), ctx.signal);
        rmSync(join(dir, tmp), { recursive: true, force: true });
      }
      const reversed = addDerived(store, analyze, name, rel, media, { kind: 'reverse', mediaId: media.id, in: t0, out: t1 }, 'معكوس');
      // the clip may have changed while this ran: swap only if it still plays the same part
      const now = store.get(name).project.clips.find((c) => c.id === clipId);
      if (now && now.mediaId === media.id && now.in >= t0 - EPS && now.out <= t1 + EPS) {
        store.apply(name, [{ op: 'replace_media', clipId, mediaId: reversed.id, in: Math.max(0, t1 - now.out), out: t1 - now.in }], author);
        return { mediaId: reversed.id, clipId, swapped: true };
      }
      return { mediaId: reversed.id, clipId, swapped: false };
    });
    return { job };
  });
}
