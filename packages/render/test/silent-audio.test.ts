import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Clip, Media, Project, defaultTracks } from '@edit/shared';
import { compile, fileKey, FFMPEG, runPlan, type Quality } from '../src/index.ts';

const workspace = mkdtempSync(join(tmpdir(), 'edit-silent-audio-test-'));
function ffmpeg(args: string[]) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result.stdout;
}
beforeAll(() => {
  // Real inputs: no audio stream, a present but digitally silent audio stream, and an audible bed.
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(workspace, 'no-audio.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(workspace, 'silent-audio.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', join(workspace, 'bed.wav')]);
});
afterAll(() => {
  const rel = relative(resolve(tmpdir()), resolve(workspace));
  if (!rel.startsWith('edit-silent-audio-test-') || isAbsolute(rel) || rel.includes('..')) throw new Error('unsafe silent test cleanup');
  rmSync(workspace, { recursive: true, force: true });
});

function base(hasAudio = false) {
  return Project.parse({
    name: 'silent', createdAt: '2026-10-29', tracks: defaultTracks(),
    settings: { aspect: '1:1', resolution: 64, fps: 24 },
    media: [{ id: 'm', path: hasAudio ? 'silent-audio.mp4' : 'no-audio.mp4', role: 'source', kind: 'video', name: 'silent', duration: 2, width: 64, height: 64, fps: 24, hasAudio }],
    clips: [{ id: 'main', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 2 }],
  });
}

async function renderAndInspect(project: Project, quality: Quality, name: string) {
  const plan = compile(project, { quality, nvenc: false, output: `renders/${name}.mp4`, fileKey: fileKey(workspace) });
  // runPlan writes its concat file under cache; segment execution creates this directory normally.
  mkdirSync(join(workspace, 'cache'), { recursive: true });
  await runPlan(plan, workspace, () => {});
  const file = join(workspace, plan.final.output);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8', windowsHide: true });
  expect(probe.status, probe.stderr).toBe(0);
  const metadata = JSON.parse(probe.stdout);
  expect(Number(metadata.format.duration)).toBeCloseTo(plan.duration, 1);
  expect(metadata.streams.find((s: { codec_name: string }) => s.codec_name === 'h264')).toMatchObject({ width: 64, height: 64 });
  expect(metadata.streams.find((s: { codec_name: string }) => s.codec_name === 'aac')).toMatchObject({ sample_rate: '48000', channels: 2 });
  const decoded = ffmpeg(['-i', file, '-map', '0:a:0', '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1']);
  expect(decoded.length).toBeGreaterThan(48000 * 4);
  let peak = 0, finite = true;
  for (let i = 0; i + 4 <= decoded.length; i += 4) {
    const sample = decoded.readFloatLE(i);
    finite &&= Number.isFinite(sample);
    peak = Math.max(peak, Math.abs(sample));
  }
  expect(finite).toBe(true);
  return peak;
}

describe('real short silent exports', () => {
  it.each(['final', 'preview'] as const)('preserves digital silence without an audio source (%s CPU64x64)', async (quality) => {
    expect(await renderAndInspect(base(), quality, `no-audio-${quality}`)).toBe(0);
  }, 20000);

  it('preserves digital silence when the source declares an audio stream', async () => {
    expect(await renderAndInspect(base(true), 'final', 'silent-stream')).toBe(0);
  }, 20000);

  it('keeps a longer silent edit at its original duration', async () => {
    const p = base();
    p.clips.push(Clip.parse({ ...p.clips[0], id: 'second', start: 2 }));
    expect(await renderAndInspect(p, 'final', 'long-silence')).toBe(0);
  }, 20000);

  it('retains audible background music over a silent main track', async () => {
    const p = base();
    p.media.push(Media.parse({ id: 'music', path: 'bed.wav', role: 'music', kind: 'audio', name: 'bed', duration: 2, hasAudio: true }));
    p.clips.push(Clip.parse({ id: 'bed', trackId: 'A2', mediaId: 'music', start: 0, in: 0, out: 2, volume: 0.5 }));
    const peak = await renderAndInspect(p, 'final', 'silent-with-bed');
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThan(1);
  }, 20000);
});
