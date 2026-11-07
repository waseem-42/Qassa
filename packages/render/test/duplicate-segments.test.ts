import { afterAll, beforeAll, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Project, defaultTracks } from '@edit/shared';
import { compile, fileKey, FFMPEG, runPlan } from '../src/index.ts';

// «تشويقة» had two main-track pieces that compile to the same cached segment; rendering both at once
// raced on one .part file and the failed rename took the whole server down.
const workspace = mkdtempSync(join(tmpdir(), 'edit-duplicate-segments-test-'));
beforeAll(() => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', join(workspace, 'voice.wav')], { windowsHide: true });
  expect(r.status, r.stderr?.toString()).toBe(0);
});
afterAll(() => {
  const rel = relative(resolve(tmpdir()), resolve(workspace));
  if (!rel.startsWith('edit-duplicate-segments-test-') || isAbsolute(rel) || rel.includes('..')) throw new Error('unsafe test cleanup');
  rmSync(workspace, { recursive: true, force: true });
});

it('renders identical segments once and finishes', async () => {
  const p = Project.parse({
    name: 'dup', createdAt: '2026-11-07', tracks: defaultTracks(), settings: { aspect: '1:1', resolution: 64, fps: 24 },
    media: [{ id: 'v', path: 'voice.wav', role: 'source', kind: 'audio', name: 'voice', duration: 2, hasAudio: true }],
    clips: [{ id: 'a', trackId: 'V1', mediaId: 'v', start: 0, in: 0, out: 2 }, { id: 'b', trackId: 'V1', mediaId: 'v', start: 2, in: 0, out: 2 }],
  });
  const plan = compile(p, { quality: 'final', nvenc: false, output: 'renders/dup.mp4', fileKey: fileKey(workspace) });
  const outputs = plan.segments.map((s) => s.output);
  expect(new Set(outputs).size).toBeLessThan(outputs.length);
  mkdirSync(join(workspace, 'cache'), { recursive: true });
  await runPlan(plan, workspace, () => {});
  expect(existsSync(join(workspace, plan.final.output))).toBe(true);
  expect(readdirSync(join(workspace, 'cache/segments')).filter((f) => f.includes('.part'))).toEqual([]);
});
