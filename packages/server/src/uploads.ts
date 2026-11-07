import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { Media, OpError, type MediaTarget } from '@edit/shared';
import { addMedia } from './media.ts';
import type { Store } from './store.ts';
import type { Jobs } from './jobs.ts';

const Query = z.object({
  role: Media.shape.role.optional(), trackId: z.string().optional(),
  at: z.coerce.number().finite().min(0).optional(), newTrack: z.enum(['1']).optional(),
  trackIndex: z.coerce.number().int().min(1).optional(),
});

export function registerUploads(app: FastifyInstance, store: Store, jobs: Jobs, options: { analyze?: boolean } = {}) {
  app.post<{ Params: { name: string } }>('/api/projects/:name/upload', async (req) => {
    const name = req.params.name, dir = store.dir(name);
    store.get(name);
    const q = Query.parse(req.query);
    const added: Media[] = [];
    // @fastify/busboy decodes disposition parameters as UTF-8 as well as field text.
    for await (const part of req.files({ defCharset: 'utf8' })) {
      const sub = q.role === 'ref' ? 'refs' : q.role === 'graphic' ? 'graphics' : 'source';
      mkdirSync(join(dir, sub), { recursive: true });
      const filename = basename(part.filename.replace(/\\/g, '/'));
      const dest = join(dir, sub, `${randomUUID()}${extname(filename).replace(/[^.a-z0-9]/gi, '')}`);
      try {
        await pipeline(part.file, createWriteStream(dest, { flags: 'wx' }));
        if (part.file.truncated || req.raw.aborted) throw new OpError('أُلغي الرفع أو تجاوز الملف الحد');
        const placement: MediaTarget | undefined = q.trackId || q.newTrack || !q.role ? { trackId: q.trackId, at: q.at, newTrack: !!q.newTrack, trackIndex: q.trackIndex } : undefined;
        added.push(addMedia(store, jobs, name, dest, q.role, { analyze: options.analyze, placement, name: filename }));
      } catch (e) {
        // A registered media may already be in use; only remove incomplete/unregistered uploads.
        if (!store.get(name).project.media.some((m) => join(dir, m.path) === dest)) rmSync(dest, { force: true });
        throw e;
      }
    }
    return { added };
  });
}
