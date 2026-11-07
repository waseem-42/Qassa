import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { defaultTracks, Project } from '@edit/shared';
import { compile, fileKey, runPlan } from '../src/index.ts';

it('a real voice track stays level at its start and ducks the bed over a silent spine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qassa-voice-'));
  const ff = (args: string[]) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { cwd: dir, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    expect(r.status, r.stderr?.toString()).toBe(0); return r.stdout;
  };
  try {
    ff(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=4', '-c:v', 'libx264', 'silent.mp4']);
    for (const [name, freq] of [['voice', 440], ['bed', 880]]) ff(['-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=48000:duration=4`, `${name}.wav`]);
    const p = Project.parse({ name: 'mix', createdAt: '', settings: { aspect: '1:1', resolution: 64, fps: 24 }, tracks: [...defaultTracks(), { id: 'voice', kind: 'audio', name: 'voice', audio: 'voice' }], media: [{ id: 'main', name: 'silent', path: 'silent.mp4', kind: 'video', role: 'source', duration: 4, width: 64, height: 64 }, ...['voice', 'bed'].map((id) => ({ id, name: id, path: `${id}.wav`, kind: 'audio', role: 'music', hasAudio: true, duration: 4 }))], clips: [{ id: 'main', trackId: 'V1', mediaId: 'main', start: 0, in: 0, out: 4 }, { id: 'speech', trackId: 'voice', mediaId: 'voice', start: 1, in: 0, out: 1.4 }, { id: 'music', trackId: 'A2', mediaId: 'bed', start: 0, in: 0, out: 4, volume: .5 }] });
    mkdirSync(join(dir, 'cache'));
    const plan = compile(p, { quality: 'preview', nvenc: false, fileKey: fileKey(dir), output: 'renders/mix.mp4' });
    await runPlan(plan, dir, () => {});
    const pcm = ff(['-i', plan.final.output, '-map', '0:a', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    const amplitude = (freq: number, from: number) => {
      let re = 0, im = 0; const len = 4800;
      for (let k = 0; k < len; k++) { const sample = pcm.readFloatLE((Math.round(from * 48000) + k) * 4), a = 2 * Math.PI * freq * k / 48000; re += sample * Math.cos(a); im += sample * Math.sin(a); }
      return 2 * Math.hypot(re, im) / len;
    };
    expect(amplitude(440, 1.05) / amplitude(440, 1.5)).toBeGreaterThan(.85);
    expect(amplitude(440, 1.05) / amplitude(440, 1.5)).toBeLessThan(1.15);
    expect(amplitude(880, 1.6) / amplitude(880, .7)).toBeLessThan(.6);
  } finally {
    if (!relative(tmpdir(), dir).startsWith('qassa-voice-')) throw new Error('unsafe cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
