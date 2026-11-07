import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Clip, defaultTracks, exportRange, Project, projectDuration } from '@edit/shared';
import { compile, fileKey, runPlan } from '../src/index.ts';
import { exportPreflight } from '../../server/src/export-preflight.ts';

it('fills leading, interior and trailing V1 gaps, and does not blend across a gap', () => {
  const p = Project.parse({ name: 'gaps', createdAt: '', tracks: defaultTracks(), media: [{ id: 'v', name: 'v', path: 'v.mp4', kind: 'video', role: 'source', duration: 2, width: 64, height: 64 }], clips: [{ id: 'first', trackId: 'V1', mediaId: 'v', start: 1, in: 0, out: 1 }, { id: 'next', trackId: 'V1', mediaId: 'v', start: 3, in: 0, out: 1, transition: { kind: 'crossfade', duration: .5 } }, { id: 'title', trackId: 'T1', text: 'نهاية', start: 4, in: 0, out: 1 }] });
  const plan = compile(p, { quality: 'preview', nvenc: false, fileKey: () => '' });
  expect(plan.duration).toBe(5);
  expect(plan.segments.map((s) => s.clipId)).toEqual(['black:0', 'first', 'black:60', 'next', 'black:120']);
});

it('plays both audio clips over black without V1, then preserves layers and sound beyond V1 in a real export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qassa-free-timeline-'));
  const ff = (args: string[]) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { cwd: dir, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    expect(r.status, r.stderr?.toString()).toBe(0); return r.stdout;
  };
  try {
    ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', 'tone.wav']);
    ff(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-c:v', 'libx264', 'red.mp4']);
    const p = Project.parse({ name: 'free', createdAt: '', tracks: defaultTracks(), settings: { aspect: '1:1', resolution: 64, fps: 24 }, media: [{ id: 'a', name: 'tone', path: 'tone.wav', kind: 'audio', role: 'source', duration: 1, hasAudio: true }, { id: 'v', name: 'red', path: 'red.mp4', kind: 'video', role: 'broll', duration: 1, width: 64, height: 64 }], clips: [{ id: 'first', trackId: 'A2', mediaId: 'a', start: .5, in: 0, out: 1 }, { id: 'last', trackId: 'A2', mediaId: 'a', start: 2.5, in: 0, out: 1 }] });
    mkdirSync(join(dir, 'cache'));
    for (const main of [false, true]) {
      if (main) p.clips.push(Clip.parse({ id: 'main', trackId: 'V1', mediaId: 'v', start: 0, in: 0, out: 1 }), Clip.parse({ id: 'late-picture', trackId: 'V2', mediaId: 'v', start: 2, in: 0, out: 1 }));
      expect(projectDuration(p)).toBe(3.5); expect(exportRange(p, {})).toEqual([0, 3.5]);
      expect(exportPreflight(p, 1, dir).ready).toBe(true);
      const plan = compile(p, { quality: 'preview', nvenc: false, fileKey: fileKey(dir), output: `renders/free-${main}.mp4` });
      expect(plan.duration).toBe(3.5); expect(plan.segments.at(-1)?.clipId).toMatch(/^black:/);
      await runPlan(plan, dir, () => {});
      const metadata = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(dir, plan.final.output)], { encoding: 'utf8' });
      expect(Number(JSON.parse(metadata.stdout).format.duration)).toBeCloseTo(3.5, 1);
      const audio = ff(['-i', plan.final.output, '-map', '0:a', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
      const peak = (at: number) => { let v = 0; for (let i = Math.round(at * 48000); i < Math.round((at + .1) * 48000); i++) v = Math.max(v, Math.abs(audio.readFloatLE(i * 4))); return v; };
      expect(peak(.9)).toBeGreaterThan(.02); expect(peak(2.9)).toBeGreaterThan(.02); expect(peak(1.8)).toBeLessThan(.0001);
      const pixel = (at: number) => ff(['-ss', String(at), '-i', plan.final.output, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      expect(Math.max(...pixel(1.8))).toBeLessThan(5);
      if (main) expect(pixel(2.3)[0]).toBeGreaterThan(200);
      else expect(Math.max(...pixel(2.3))).toBeLessThan(5);
    }
  } finally {
    if (!relative(tmpdir(), dir).startsWith('qassa-free-timeline-')) throw new Error('unsafe cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
