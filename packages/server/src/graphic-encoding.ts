import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { FFMPEG } from '@edit/render';

/** Full-resolution 4:4:4 colour and a separate lossless alpha plane, in one seekable file. */
export const GRAPHIC_ENCODING = [
  '-filter_complex', '[0:v]format=rgba,split[colour][a];[a]alphaextract[alpha]',
  '-map', '[colour]', '-map', '[alpha]',
  '-c:v:0', 'libx264', '-preset:v:0', 'fast', '-crf:v:0', '13', '-pix_fmt:v:0', 'yuv444p',
  '-c:v:1', 'ffv1', '-level:v:1', '3', '-pix_fmt:v:1', 'gray', '-threads:v:0', '2', '-threads:v:1', '1',
];

export async function encodeGraphicParts(dir: string, parts: { list: string; frames: number; w: number }[], fps: number, samples: number, signal?: AbortSignal, fast = false) {
  const queue = [...parts], files: string[] = [];
  let fallbacks = 0;
  const ctrl = new AbortController(), abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) ctrl.abort();
  const worker = async () => {
    try {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const { list, frames, w } = job, part = `${w}.mkv`;
        const encoding = [...GRAPHIC_ENCODING];
        // Superfast is ~3× faster on the grain-heavy fixture, with better PSNR/SSIM at the same CRF.
        // Keep library templates on their original encoder so their decoded frames stay exact.
        if (fast) encoding[encoding.indexOf('-preset:v:0') + 1] = 'superfast';
        if (samples > 1) encoding[1] = `[0:v]fps=${fps * samples},tmix=frames=${samples},select=eq(mod(n\\,${samples})\\,${samples - 1}),setpts=N/(${fps}*TB),fps=${fps},format=rgba,split[colour][a];[a]alphaextract[alpha]`;
        const encode = () => graphicEncode(['-filter_complex_threads', '1', '-threads', '2', '-f', 'concat', '-safe', '0', '-i', list, ...encoding, '-enc_time_base:v', `1:${fps}`, '-fps_mode:v', 'vfr', '-t', String(frames / fps), part], dir, ctrl.signal);
        try { await encode(); }
        catch (e) {
          if (!fast || ctrl.signal.aborted) throw e;
          encoding[encoding.indexOf('-preset:v:0') + 1] = 'fast';
          fallbacks++;
          await encode();
        }
        files[w] = part;
      }
    } catch (e) { ctrl.abort(); throw e; }
  };
  try {
    const results = await Promise.allSettled(Array.from({ length: Math.min(2, parts.length, Math.max(1, Math.floor(availableParallelism() / 3))) }, worker));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    writeFileSync(join(dir, 'join.txt'), files.map((f) => `file '${f}'`).join('\n'));
    await graphicEncode(['-f', 'concat', '-safe', '0', '-i', 'join.txt', '-map', '0', '-c', 'copy', 'joined.mkv'], dir, ctrl.signal);
    return { fallbacks };
  } finally { signal?.removeEventListener('abort', abort); }
}

export function graphicEncode(args: string[], cwd: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('cancelled'));
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true });
    let err = '';
    const abort = () => ff.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    ff.stderr.setEncoding('utf8').on('data', (s: string) => { err = (err + s).slice(-4000); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('cancelled'));
      else if (code !== 0) reject(new Error(`ffmpeg (graphic): ${err.trim()}`));
      else resolve();
    });
  });
}
