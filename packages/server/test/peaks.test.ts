import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/store.ts';
import { makePeaks, normalizePeaks, PeakCache } from '../src/peaks.ts';

describe('on-demand sound waves', () => {
  it('normalizes with the same interpolated 99.5th percentile as numpy', () => {
    expect(normalizePeaks([0, .1, .2, .3, 1]).data).toEqual([0, .101, .203, .304, 1]);
    expect(normalizePeaks([0, 0]).data).toEqual([0, 0]);
  });
  it('streams real audio, rebuilds missing output, and deduplicates simultaneous requests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qassa-peaks-'));
    const store = new Store(root, { watch: false });
    try {
      store.create('test');
      const dir = store.dir('test');
      const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-y', 'source/tone.wav'], { cwd: dir });
      expect(generated.status).toBe(0);
      store.mutate('test', (p) => p.media.push({ id: 'tone', path: 'source/tone.wav', name: 'tone', role: 'music', kind: 'audio', duration: 1, width: 0, height: 0, fps: 0, hasAudio: true, analyzed: [] }));
      let ready = 0;
      const cache = new PeakCache(store, () => ready++);
      const [a, b] = await Promise.all([cache.get('test', 'tone'), cache.get('test', 'tone')]);
      expect(a).toEqual(b); expect(a.data).toHaveLength(50); expect(Math.max(...a.data)).toBe(1);
      expect(ready).toBe(1); expect(existsSync(join(dir, 'analysis/tone/peaks.json'))).toBe(true);
      await cache.get('test', 'tone'); expect(ready).toBe(1);
      rmSync(join(dir, 'analysis/tone/peaks.json'));
      await cache.get('test', 'tone'); expect(ready).toBe(2);
      expect((await makePeaks(dir, 'source/tone.wav')).data).toHaveLength(50);
      expect(store.get('test').project.media[0].analyzed).toEqual([]);
      await expect(cache.get('test', '../bad')).rejects.toThrow('media not found');
    } finally {
      await store.close();
      if (!relative(resolve(tmpdir()), root).startsWith('qassa-peaks-')) throw new Error('unsafe cleanup');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
