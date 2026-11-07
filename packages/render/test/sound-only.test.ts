import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyOps, defaultTracks, Picture, Project } from '@edit/shared';
import { compile, fileKey, runPlan } from '../src/index.ts';
import { compositeFrames } from '../../server/src/sheets.ts';

it('real mp4 sound survives on black V1, invisible overlay and audio track; contact sheets agree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qassa-sound-only-'));
  const ff = (args: string[]) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    expect(r.status, r.stderr?.toString()).toBe(0); return r.stdout;
  };
  try {
    ff(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', 'tone.mp4']);
    const base = Project.parse({ name: 'qa', createdAt: '', tracks: defaultTracks(), settings: { aspect: '1:1', resolution: 64, fps: 24 }, media: [{ id: 'm', name: 'tone', path: 'tone.mp4', kind: 'video', role: 'source', duration: 1, width: 64, height: 64, hasAudio: true }], clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 1, picture: Picture.parse({ off: true }) }] });
    for (const trackId of ['V1', 'V2', 'A2']) {
      const p = trackId === 'V1' ? base : applyOps(base, [{ op: 'update_clip', clipId: 'c', patch: { volume: 0 } }, { op: 'add_clip', clip: { mediaId: 'm', trackId, in: 0, out: 1, picture: Picture.parse({ off: true }), fadeIn: 0, fadeOut: 0 } }]);
      mkdirSync(join(root, 'cache'), { recursive: true });
      const plan = compile(p, { quality: 'preview', nvenc: false, fileKey: fileKey(root), output: `renders/${trackId}.mp4` });
      await runPlan(plan, root, () => {});
      const pixel = ff(['-ss', '0.5', '-i', plan.final.output, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      expect(Math.max(...pixel)).toBeLessThan(5);
      const audio = ff(['-i', plan.final.output, '-map', '0:a', '-f', 'f32le', 'pipe:1']);
      let peak = 0; for (let i = 0; i < audio.length; i += 4) peak = Math.max(peak, Math.abs(audio.readFloatLE(i)));
      expect(peak).toBeGreaterThan(.01);
      const tmp = `cache/sheet-${trackId}`; mkdirSync(join(root, tmp), { recursive: true });
      await compositeFrames('qa', p, root, [.5], 64, 64, tmp);
      const sheet = ff(['-i', `${tmp}/f000.jpg`, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      expect(Math.max(...sheet)).toBeLessThan(5);
    }
    ff(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1', 'blue.png']);
    for (const reversed of [false, true]) {
      let p = Project.parse({ ...base, tracks: defaultTracks('podcast'), media: [...base.media, { id: 'blue', name: 'blue', path: 'blue.png', kind: 'image', role: 'broll' }], clips: [...base.clips, { id: 'red', trackId: 'V2', mediaId: 'm', start: 0, in: 0, out: 1, volume: 0 }, { id: 'blue', trackId: 'V3', mediaId: 'blue', start: 0, in: 0, out: 1 }] });
      if (reversed) p = applyOps(p, [{ op: 'move_track', trackId: 'V3', index: 1 }]);
      const plan = compile(p, { quality: 'preview', nvenc: false, fileKey: fileKey(root), output: `renders/order-${reversed}.mp4` });
      await runPlan(plan, root, () => {});
      const pixel = ff(['-ss', '0.5', '-i', plan.final.output, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      expect(pixel[reversed ? 0 : 2]).toBeGreaterThan(200);
      const tmp = `cache/order-${reversed}`; mkdirSync(join(root, tmp));
      await compositeFrames('qa', p, root, [.5], 64, 64, tmp);
      const sheet = ff(['-i', `${tmp}/f000.jpg`, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
      expect(sheet[reversed ? 0 : 2]).toBeGreaterThan(200);
    }
  } finally {
    if (!relative(tmpdir(), root).startsWith('qassa-sound-only-')) throw new Error('unsafe cleanup');
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
