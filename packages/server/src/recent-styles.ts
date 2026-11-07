import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { OpError, STYLE_PRESETS, StyleUse, type StyleUse as Use } from '@edit/shared';
import { DATA_DIR } from './config.ts';
import { assertNoLink } from './project-paths.ts';
import { styleCatalog } from './style-library.ts';
import { savedStyles } from './styles.ts';
import type { Store } from './store.ts';

const Recent = StyleUse.pick({ id: true, source: true, at: true, by: true }).extend({ project: z.string() });
export type RecentStyle = z.infer<typeof Recent>;
const FILE = process.env.EDIT_STYLE_RECENT_FILE ? resolve(process.env.EDIT_STYLE_RECENT_FILE) : join(DATA_DIR, 'styles/recent.json');
const LIMIT = 50;

export class RecentStyles {
  constructor(private file = FILE) {}
  list(): RecentStyle[] {
    assertNoLink(this.file);
    if (!existsSync(this.file)) return [];
    return z.array(Recent).parse(JSON.parse(readFileSync(this.file, 'utf8'))).slice(0, LIMIT);
  }
  private write(rows: RecentStyle[]) {
    assertNoLink(dirname(this.file)); assertNoLink(this.file); assertNoLink(`${this.file}.tmp`);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(rows.slice(0, LIMIT), null, 2));
    renameSync(`${this.file}.tmp`, this.file);
    return rows.slice(0, LIMIT);
  }
  add(entry: RecentStyle) {
    const next = Recent.parse(entry);
    return this.write([next, ...this.list().filter((r) => !(r.id === next.id && r.source === next.source && r.project === next.project))]);
  }
  remove(id?: string, project?: string) {
    return this.write(id ? this.list().filter((r) => r.id !== id || (project !== undefined && r.project !== project)) : []);
  }
}

function info(id: string, source: RecentStyle['source']) {
  if (source === 'library') { const e = styleCatalog().entries.find((e) => e.id === id); return e && { name: e.title }; }
  return (source === 'preset' ? STYLE_PRESETS : savedStyles()).find((s) => s.id === id);
}

export function registerRecentStyles(app: FastifyInstance, store: Store, recent = new RecentStyles()) {
  const remember = (project: string, use: Use) => {
    try { recent.add({ id: use.id, source: use.source, project, at: use.at, by: use.by }); }
    catch (error) { app.log.warn(error); }
  };
  store.on('style_used', remember);
  app.addHook('onClose', async () => { store.off('style_used', remember); });
  app.get('/api/style-library/recent', async () => recent.list().map((row) => { const entry = info(row.id, row.source); return { ...row, name: entry?.name ?? row.id, available: !!entry }; }));
  app.post<{ Body: unknown }>('/api/style-library/recent', async (req) => {
    const body = Recent.omit({ at: true }).strict().parse(req.body);
    if (!info(body.id, body.source)) throw new OpError('style not found');
    if (body.project) store.get(body.project);
    return recent.add({ ...body, at: new Date().toISOString() });
  });
  app.delete('/api/style-library/recent', async () => recent.remove());
  app.delete<{ Params: { id: string }; Querystring: { project?: string } }>('/api/style-library/recent/:id', async (req) => recent.remove(req.params.id, req.query.project));
  app.get<{ Params: { id: string } }>('/api/style-library/:id/usage', async (req) => store.list().flatMap((item) => {
    const use = store.get(item.name).project.stylesUsed.find((u) => u.id === req.params.id);
    return use ? [{ ...use, project: item.name, name: item.displayName }] : [];
  }));
}
