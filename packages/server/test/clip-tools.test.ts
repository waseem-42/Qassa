import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mainClips, OpError, Project, defaultTracks } from '@edit/shared';
import { FFMPEG } from '@edit/render';
import { registerClipTools, reverseChunk, reversePieces } from '../src/clip-tools.ts';
import { ffprobe } from '../src/media.ts';
import { Store } from '../src/store.ts';
import { Jobs } from '../src/jobs.ts';

const workspace = mkdtempSync(join(tmpdir(), 'edit-cliptools-test-'));
let store: Store, jobs: Jobs, app: FastifyInstance, dir: string;
const analyzed: string[] = [];
beforeEach(() => {
  store = new Store(mkdtempSync(join(workspace, 'case-')), { watch: false });
  store.create('p');
  dir = store.dir('p');
  jobs = new Jobs();
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof OpError || err instanceof z.ZodError ? 400 : 500).send({ error: (err as Error).message }));
  registerClipTools(app, store, jobs, (_n, id) => analyzed.push(id));
});
afterEach(async () => { await app.close(); await store.close(); });
afterAll(() => {
  const rel = relative(resolve(tmpdir()), resolve(workspace));
  if (!rel.startsWith('edit-cliptools-test-') || isAbsolute(rel) || rel.includes('..')) throw new Error('unsafe test cleanup');
  rmSync(workspace, { recursive: true, force: true });
});

/** 3 s of a frame counter (each second its own colour) with a rising tone. */
function video() {
  mkdirSync(join(dir, 'source'), { recursive: true });
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=10:d=1', '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=10:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10:d=1',
    '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'source/a.mp4'], { cwd: dir });
  if (r.status !== 0) throw new Error(String(r.stderr));
  store.mutate('p', (p) => Object.assign(p, Project.parse({
    name: 'p', createdAt: p.createdAt, tracks: defaultTracks(), settings: { fps: 10 },
    media: [{ id: 'm', path: 'source/a.mp4', role: 'source', kind: 'video', name: 'a', duration: 3, width: 320, height: 180, fps: 10, hasAudio: true }],
    clips: [{ id: 'c', trackId: 'V1', mediaId: 'm', start: 0, in: 0, out: 3 }],
  })));
}
/** average colour of a frame of a project file */
function colour(rel: string, t: number): [number, number, number] {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', rel, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { cwd: dir });
  return [...r.stdout.subarray(0, 3)] as [number, number, number];
}
const main = (c: number[]) => c.indexOf(Math.max(...c)); // 0 red, 1 green, 2 blue

describe('reverse pieces', () => {
  it('cuts the range from the end backwards in bounded pieces', () => {
    expect(reversePieces(1, 6, 2)).toEqual([[4, 2], [2, 2], [1, 1]]);
    expect(reverseChunk({ width: 3840, height: 2160, fps: 30 })).toBeLessThan(reverseChunk({ width: 1920, height: 1080, fps: 30 }));
    expect(reverseChunk({ width: 320, height: 180, fps: 10 })).toBe(6);
  });
});

describe('freeze and reverse', () => {
  it('freeze: grabs the frame under the playhead as a still and holds it in the edit', async () => {
    video();
    const r = await app.inject({ method: 'POST', url: '/api/projects/p/clips/c/freeze', payload: { at: 1.5, duration: 2 } });
    expect(r.statusCode).toBe(200);
    const still = r.json().media;
    expect(still).toMatchObject({ kind: 'image', width: 320, height: 180, derived: { kind: 'freeze', mediaId: 'm', in: 1.5 } });
    expect(main(colour(still.path, 0))).toBe(1); // second 1..2 is green
    expect(mainClips(store.get('p').project).map((c) => [c.mediaId, c.start, c.in, c.out])).toEqual([['m', 0, 0, 1.5], [still.id, 1.5, 0, 2], ['m', 3.5, 1.5, 3]]);
    // the same frame again (the start of the rest) reuses the still
    const rest = mainClips(store.get('p').project)[2];
    const again = await app.inject({ method: 'POST', url: `/api/projects/p/clips/${rest.id}/freeze`, payload: { at: 3.5 } });
    expect(again.json().media.id).toBe(still.id);
  });

  it('reverse: makes the part played backwards (sound too), swaps it in, and swaps back without re-rendering', async () => {
    video();
    store.apply('p', [{ op: 'trim', clipId: 'c', in: 0.5, out: 2.5 }]);
    const r = await app.inject({ method: 'POST', url: '/api/projects/p/clips/c/reverse', payload: {} });
    const job = await jobs.wait(r.json().job.id, 60_000);
    expect(job?.status, job?.error).toBe('done');
    const p = store.get('p').project;
    const rev = p.media.find((m) => m.derived?.kind === 'reverse')!;
    expect(rev).toMatchObject({ kind: 'video', hasAudio: true, derived: { mediaId: 'm', in: 0.5, out: 2.5 } });
    expect(Math.abs(ffprobe(join(dir, rev.path)).duration - 2)).toBeLessThan(0.15);
    expect(analyzed).toContain(rev.id);
    expect(existsSync(join(dir, 'cache/reverse'))).toBe(true); // the folder stays, the pieces are gone
    // it starts where the original ended (blue) and ends where it began (red)
    expect(main(colour(rev.path, 0.1))).toBe(2);
    expect(main(colour(rev.path, 1.9))).toBe(0);
    expect(p.clips.find((c) => c.id === 'c')).toMatchObject({ mediaId: rev.id, in: 0, out: 2 });
    // back: no job, straight to the original part
    const back = await app.inject({ method: 'POST', url: '/api/projects/p/clips/c/reverse', payload: {} });
    expect(back.json()).toMatchObject({ done: true, reversed: false });
    expect(store.get('p').project.clips.find((c) => c.id === 'c')).toMatchObject({ mediaId: 'm', in: 0.5, out: 2.5 });
    // and forward again reuses the file
    const fwd = await app.inject({ method: 'POST', url: '/api/projects/p/clips/c/reverse', payload: {} });
    expect(fwd.json()).toMatchObject({ done: true, reversed: true });
  }, 60_000);

  it('refuses a still or a missing clip', async () => {
    video();
    expect((await app.inject({ method: 'POST', url: '/api/projects/p/clips/nope/reverse', payload: {} })).statusCode).toBe(400);
  });
});
