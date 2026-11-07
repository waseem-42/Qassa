import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpError } from '@edit/shared';
import { assertNoLink, assertWithin } from './project-paths.ts';
import type { Store } from './store.ts';

export interface Peaks { rate: number; data: number[] }

export function normalizePeaks(data: number[]): Peaks {
  const sorted = [...data].sort((a, b) => a - b);
  const at = (sorted.length - 1) * 0.995, lo = Math.floor(at);
  const top = sorted.length ? sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo) : 1;
  return { rate: 50, data: data.map((v) => Math.round(Math.min(1, v / Math.max(top, 1e-4)) * 1000) / 1000) };
}

/** Stream PCM rather than holding a recording's decoded audio in memory. */
export function makePeaks(dir: string, path: string): Promise<Peaks> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { cwd: dir, windowsHide: true });
    const data: number[] = [];
    let tail: Buffer = Buffer.alloc(0), samples = 0, peak = 0, error = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const bytes = tail.length ? Buffer.concat([tail, chunk]) : chunk;
      const end = bytes.length - bytes.length % 2;
      for (let i = 0; i < end; i += 2) {
        peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)) / 32768);
        if (++samples === 160) { data.push(peak); samples = 0; peak = 0; }
      }
      tail = bytes.subarray(end);
    });
    child.stderr.on('data', (chunk) => { error = (error + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(normalizePeaks(data)) : reject(new Error(`waveform: ${error.trim()}`)));
  });
}

export class PeakCache {
  private pending = new Map<string, Promise<Peaks>>();
  constructor(private store: Store, private ready: (name: string, mediaId: string) => void = () => {}) {}

  async get(name: string, mediaId: string): Promise<Peaks> {
    const media = this.store.get(name).project.media.find((m) => m.id === mediaId);
    if (!media) throw new OpError('media not found');
    if (!media.hasAudio || media.kind === 'image') return { rate: 50, data: [] };
    const dir = this.store.dir(name), folder = join(dir, 'analysis', media.id), file = join(folder, 'peaks.json');
    assertWithin(dir, folder);
    assertNoLink(join(dir, 'analysis')); assertNoLink(folder); assertNoLink(file);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    let pending = this.pending.get(file);
    if (!pending) {
      pending = makePeaks(dir, media.path).then((peaks) => {
        assertNoLink(join(dir, 'analysis')); assertNoLink(folder);
        mkdirSync(folder, { recursive: true });
        const temp = join(folder, 'peaks-demand.tmp');
        assertNoLink(temp); assertNoLink(file);
        writeFileSync(temp, JSON.stringify(peaks));
        renameSync(temp, file);
        this.ready(name, mediaId);
        return peaks;
      }).finally(() => this.pending.delete(file));
      this.pending.set(file, pending);
    }
    return pending;
  }
}

