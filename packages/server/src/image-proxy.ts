import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { FFMPEG } from '@edit/render';
import type { Media } from '@edit/shared';
import type { Store } from './store.ts';

/** The longest side the editor ever needs for a still (preview, timeline, library); export keeps the original. */
export const PREVIEW_MAX = 1920;
const ALPHA = /rgba|bgra|argb|abgr|^ya|yuva|gbrap|pal8/;

/**
 * A still larger than PREVIEW_MAX gets a smaller copy as its proxy: a 4K photo decoded and uploaded to the GPU
 * on every preview frame made the editor crawl. PNG when the still can be see-through, JPEG otherwise.
 */
export function imageProxy(dir: string, m: Media): string | undefined {
  if (m.kind !== 'image' || Math.max(m.width, m.height) <= PREVIEW_MAX) return undefined;
  const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', m.path], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const alpha = ALPHA.test(probe.stdout.trim());
  const rel = `analysis/${m.id}/preview.${alpha ? 'png' : 'jpg'}`;
  mkdirSync(join(dir, 'analysis', m.id), { recursive: true });
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-i', m.path, '-frames:v', '1', '-vf', `scale=w='min(${PREVIEW_MAX},iw)':h='min(${PREVIEW_MAX},ih)':force_original_aspect_ratio=decrease`, ...(alpha ? [] : ['-q:v', '3']), rel], { cwd: dir, windowsHide: true });
  return r.status === 0 && existsSync(join(dir, rel)) ? rel : undefined;
}

const tried = new Set<string>();
/** Projects made before stills had proxies get them once, as bookkeeping (not an undo step). */
export function ensureImageProxies(store: Store, name: string) {
  const dir = store.dir(name), made = new Map<string, string>();
  for (const m of store.get(name).project.media) {
    if (m.kind !== 'image' || m.proxy || Math.max(m.width, m.height) <= PREVIEW_MAX || tried.has(`${dir}|${m.id}`) || !existsSync(isAbsolute(m.path) ? m.path : join(dir, m.path))) continue;
    tried.add(`${dir}|${m.id}`);
    const proxy = imageProxy(dir, m);
    if (proxy) made.set(m.id, proxy);
  }
  if (made.size) store.mutate(name, (p) => { for (const m of p.media) if (made.has(m.id)) m.proxy = made.get(m.id); });
}
