import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LOUDNESS_GAIN, type FfmpegJob, type RenderPlan } from './compile.ts';

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

let nvencCache: boolean | undefined;
export function hasNvenc(): boolean {
  if (nvencCache === undefined) {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-']);
    nvencCache = r.status === 0;
  }
  return nvencCache;
}

export function fileKey(projectDir: string) {
  return (rel: string) => {
    try {
      const s = statSync(join(projectDir, rel));
      return `${s.size}:${Math.round(s.mtimeMs)}`;
    } catch {
      return 'missing';
    }
  };
}

/** ffmpeg that writes no progress for this long is stuck (e.g. a filtergraph waiting on an input forever). */
const STALL_MS = 90_000;

/** Run one ffmpeg job in the project folder; resolves when done, rejects with the stderr tail. */
export function runJob(job: FfmpegJob, cwd: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<void> {
  mkdirSync(join(cwd, dirname(job.output)), { recursive: true });
  // write to a temp name so an interrupted render never looks like a finished cache entry
  const tmp = job.output.replace(/(\.[^.]+)$/, '.part$1');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...job.args.slice(0, -1), tmp];
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { cwd, windowsHide: true });
    let err = '';
    let stalled = false;
    let lastOut = Date.now(); // when the output time last moved
    let furthest = -1;
    const watchdog = setInterval(() => {
      if (Date.now() - lastOut < STALL_MS) return;
      stalled = true;
      proc.kill('SIGKILL');
    }, 5000);
    signal?.addEventListener('abort', () => proc.kill('SIGKILL'), { once: true });
    proc.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const m = /out_time_us=(\d+)/g;
      let hit: RegExpExecArray | null, last = -1;
      while ((hit = m.exec(chunk))) last = Number(hit[1]);
      // a stuck ffmpeg keeps printing progress with the same time: only moving time counts
      if (last > furthest) { furthest = last; lastOut = Date.now(); }
      if (last >= 0 && job.duration > 0) onProgress?.(Math.min(1, last / 1e6 / job.duration));
    });
    proc.stderr.setEncoding('utf8').on('data', (c: string) => (err = (err + c).slice(-4000)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      clearInterval(watchdog);
      if (signal?.aborted) return reject(new Error('cancelled'));
      if (stalled) return reject(new Error(`ffmpeg made no progress for ${STALL_MS / 1000}s and was stopped (${job.output}). ${err.trim()}`));
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.trim()}`));
      renameSync(join(cwd, tmp), join(cwd, job.output));
      onProgress?.(1);
      resolve();
    });
  });
}

/**
 * Loudness of the whole mix (a sound-only pass through loudnorm) → the fixed gain in dB that brings it to the target.
 * Silence, or a measurement that fails to print, gets no gain.
 */
export function measureGain(m: NonNullable<RenderPlan['measure']>, cwd: string, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-nostats', '-loglevel', 'info', ...m.args], { cwd, windowsHide: true });
    let err = '';
    signal?.addEventListener('abort', () => proc.kill('SIGKILL'), { once: true });
    proc.stderr.setEncoding('utf8').on('data', (c: string) => (err = (err + c).slice(-20000)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (signal?.aborted) return reject(new Error('cancelled'));
      if (code !== 0) return reject(new Error(`ffmpeg (loudness) exited ${code}: ${err.trim().slice(-2000)}`));
      const json = [...err.matchAll(/\{[^{}]*"input_i"[^{}]*\}/g)].at(-1)?.[0];
      const input = json ? Number(JSON.parse(json).input_i) : NaN;
      resolve(Number.isFinite(input) && input > -70 ? Math.round(Math.max(-30, Math.min(30, m.target - input)) * 100) / 100 : 0);
    });
  });
}

export interface RunProgress { stage: 'segments' | 'final'; progress: number; done: number; total: number; cached: number }

/** Render missing segments (in parallel), then the final pass. */
export async function runPlan(plan: RenderPlan, cwd: string, onProgress: (p: RunProgress) => void, signal?: AbortSignal, parallel = 3): Promise<string> {
  // lists and keyframe commands first: segments read them too (sendcmd)
  for (const f of plan.files) {
    mkdirSync(join(cwd, dirname(f.path)), { recursive: true });
    writeFileSync(join(cwd, f.path), f.body, 'utf8');
  }
  const todo = plan.segments.filter((s) => !existsSync(join(cwd, s.output)));
  const cached = plan.segments.length - todo.length;
  const total = todo.reduce((t, s) => t + s.duration, 0) || 1;
  const prog = new Map<string, number>();
  let done = 0;
  const report = () => {
    const sec = todo.reduce((t, s) => t + (prog.get(s.hash) ?? 0) * s.duration, 0);
    onProgress({ stage: 'segments', progress: sec / total, done, total: todo.length, cached });
  };
  report();
  const queue = [...todo];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (signal?.aborted) throw new Error('cancelled');
      const seg = s;
      await runJob(seg, cwd, (p) => { prog.set(seg.hash, p); report(); }, signal);
      done++;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, worker));

  writeFileSync(join(cwd, plan.concatList.path), plan.concatList.body, 'utf8');
  if (signal?.aborted) throw new Error('cancelled');
  const gain = plan.measure ? await measureGain(plan.measure, cwd, signal) : 0;
  plan = { ...plan, final: { ...plan.final, args: plan.final.args.map((a) => a.replaceAll(LOUDNESS_GAIN, String(gain))) } };
  await runJob(plan.final, cwd, (p) => onProgress({ stage: 'final', progress: p, done, total: todo.length, cached }), signal);
  return plan.final.output;
}
