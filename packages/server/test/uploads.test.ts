import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { applyOps, mainClips, OpError } from '@edit/shared';
import { Store } from '../src/store.ts';
import { Jobs } from '../src/jobs.ts';
import { registerUploads } from '../src/uploads.ts';

describe('role-free uploads', () => {
  it('places video then music, keeps duplicate filenames safe, supports track drops and role undo', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qassa-upload-'));
    const store = new Store(root, { watch: false }), app = Fastify();
    app.setErrorHandler((err, _req, reply) => reply.code(err instanceof OpError ? 400 : 500).send({ error: (err as Error).message }));
    try {
      store.create('test');
      expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(root, 'clip.mp4')]).status).toBe(0);
      expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', join(root, 'song.wav')]).status).toBe(0);
      await app.register(multipart);
      registerUploads(app, store, new Jobs(), { analyze: false });
      const upload = (file: string, q = '', filename = file) => app.inject({ method: 'POST', url: `/api/projects/test/upload${q}`, headers: { 'content-type': 'multipart/form-data; boundary=qa' }, payload: Buffer.concat([Buffer.from(`--qa\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), readFileSync(join(root, file)), Buffer.from('\r\n--qa--\r\n')]) });
      const video = (await upload('clip.mp4')).json().added[0];
      expect(video.role).toBe('source'); expect(video.name).toBe('clip.mp4');
      const song = (await upload('song.wav')).json().added[0];
      expect(song.role).toBe('music');
      let p = store.get('test').project;
      expect(mainClips(p)).toHaveLength(1);
      expect(p.clips.find((c) => c.mediaId === song.id)?.trackId).toBe('A2');
      const more = (await upload('clip.mp4', '?trackId=V2&at=12')).json().added[0];
      p = store.get('test').project;
      expect(more.path).not.toBe(video.path);
      expect(p.clips.find((c) => c.mediaId === more.id)).toMatchObject({ start: 12, trackId: 'V2' });
      const before = structuredClone(p.clips);
      store.apply('test', [{ op: 'update_media', mediaId: more.id, patch: { role: 'ref' } }]);
      expect(store.get('test').project.clips).toEqual(before);
      store.undo('test'); expect(store.get('test').project.media.find((m) => m.id === more.id)?.role).toBe('broll');
      const main = await upload('clip.mp4', '?trackId=V1&at=0');
      expect(main.statusCode).toBe(200); expect(mainClips(store.get('test').project)[0].mediaId).toBe(main.json().added[0].id);
      const fresh = await upload('song.wav', '?newTrack=1&at=4');
      expect(fresh.statusCode).toBe(200);
      const c = store.get('test').project.clips.find((c) => c.mediaId === fresh.json().added[0].id)!;
      expect(c.start).toBe(4); expect(c.trackId).not.toBe('A2');
      const unicode = '🎙️【302】 تيك توك.wav';
      const named = (await upload('song.wav', '?trackId=A2&at=1', unicode)).json().added[0];
      expect(named.name).toBe(unicode); expect(named.role).toBe('music');
      store.apply('test', [{ op: 'add_track', track: { id: 'VOICE', kind: 'audio', name: 'voice', audio: 'voice' } }]);
      expect((await upload('song.wav', '?trackId=VOICE')).json().added[0].role).toBe('source');
      expect((await upload('song.wav', '?trackId=V1')).json().added[0].role).toBe('source');
      store.create('voice');
      const empty = store.get('voice').project;
      const moved = applyOps({ ...empty, media: [song] }, [{ op: 'add_clip', clip: { trackId: 'V1', mediaId: song.id, in: 0, out: 1 } }]);
      expect(mainClips(moved)).toHaveLength(1);
      const invalid = await upload('clip.mp4', '?trackId=T1');
      expect(invalid.statusCode).toBe(400);
    } finally {
      await app.close(); await store.close();
      if (!relative(tmpdir(), root).startsWith('qassa-upload-')) throw new Error('unsafe cleanup');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
