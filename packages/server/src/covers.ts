import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectDuration, outputSize, type Project } from '@edit/shared';
import { compositeFrames, evenTimes, ffmpeg } from './sheets.ts';

// The home page's picture of a project: its cover (one frame, the one the user chose or a third in)
// and a strip of frames across the edit that a hover scrubs through. Both are composited like the
// render and cached in cache/covers/ until the project changes.

export const STRIP_FRAMES = 10;
const COVER_W = 640, STRIP_W = 320;

/** The timeline second the cover shows. */
export function coverTime(p: Project): number {
  const d = projectDuration(p);
  return Math.min(Math.max(0, p.settings.cover ?? d / 3), Math.max(0, d - 0.05));
}

const inFlight = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve(); // one at a time: a full home page must not start a dozen browsers' worth of work

/** Project-relative path of the cached cover / strip JPEG; undefined when there is nothing to show yet. */
export async function projectCover(name: string, p: Project, dir: string, kind: 'cover' | 'strip'): Promise<string | undefined> {
  if (projectDuration(p) <= 0.05) return undefined;
  const modified = statSync(join(dir, 'project.json')).mtimeMs;
  const key = createHash('sha1').update(JSON.stringify([kind, Math.round(modified), coverTime(p), p.settings.aspect])).digest('hex').slice(0, 12);
  const rel = `cache/covers/${kind}-${key}.jpg`;
  if (existsSync(join(dir, rel))) return rel;
  const id = `${dir}|${rel}`;
  let job = inFlight.get(id);
  if (!job) {
    job = (queue = queue.catch(() => undefined).then(() => make(name, p, dir, kind, rel))) as Promise<string>;
    inFlight.set(id, job);
    job.finally(() => inFlight.delete(id)).catch(() => undefined);
  }
  return job;
}

async function make(name: string, p: Project, dir: string, kind: 'cover' | 'strip', rel: string): Promise<string> {
  const { width: ow, height: oh } = outputSize(p.settings);
  const W = kind === 'cover' ? COVER_W : STRIP_W;
  const H = Math.round((W * oh) / ow / 2) * 2;
  const tmp = `cache/covers/tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(join(dir, tmp), { recursive: true });
  try {
    const times = kind === 'cover' ? [coverTime(p)] : evenTimes(0, projectDuration(p), STRIP_FRAMES);
    await compositeFrames(name, p, dir, times, W, H, tmp);
    // older pictures of this kind are stale now
    for (const f of readdirSync(join(dir, 'cache/covers'))) if (f.startsWith(`${kind}-`)) rmSync(join(dir, 'cache/covers', f), { force: true });
    if (kind === 'cover') await ffmpeg(['-i', `${tmp}/f000.jpg`, '-q:v', '3', rel], dir);
    else await ffmpeg(['-framerate', '1', '-i', `${tmp}/f%03d.jpg`, '-vf', `tile=${times.length}x1`, '-frames:v', '1', '-q:v', '4', rel], dir);
    return rel;
  } finally {
    rmSync(join(dir, tmp), { recursive: true, force: true });
  }
}
