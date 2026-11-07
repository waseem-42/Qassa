import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { STYLE_PRESETS } from '@edit/shared';
import { RecentStyles, registerRecentStyles } from '../src/recent-styles.ts';
import { Store } from '../src/store.ts';

describe('global recent styles', () => {
  it('persists newest first, deduplicates per project, caps at 50, and removes one or all', () => {
    const root = mkdtempSync(join(tmpdir(), 'qassa-recent-'));
    try {
      const file = join(root, 'recent.json'), recent = new RecentStyles(file);
      for (let i = 0; i < 55; i++) recent.add({ id: String(i), source: 'library', project: 'a', by: 'user', at: '2026-10-30T00:00:00Z' });
      expect(new RecentStyles(file).list()).toHaveLength(50); expect(recent.list()[0].id).toBe('54');
      recent.add({ id: '54', source: 'library', project: 'b', by: 'claude', at: '2026-10-30T01:00:00Z' });
      recent.add({ id: '54', source: 'library', project: 'b', by: 'user', at: '2026-10-30T02:00:00Z' });
      expect(recent.list().filter((r) => r.id === '54')).toHaveLength(2);
      recent.remove('54', 'b'); expect(recent.list().filter((r) => r.id === '54')).toHaveLength(1);
      recent.remove(); expect(recent.list()).toEqual([]);
    } finally { if (!relative(resolve(tmpdir()), root).startsWith('qassa-recent-')) throw Error('unsafe cleanup'); rmSync(root, { recursive: true, force: true }); }
  });

  it('feeds from log_style, serves opening history and project usage, supports both delete routes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qassa-recent-'));
    const store = new Store(join(root, 'projects'), { watch: false }), app = Fastify();
    const recent = new RecentStyles(join(root, 'recent.json'));
    registerRecentStyles(app, store, recent);
    try {
      store.create('one'); store.create('two');
      const style = STYLE_PRESETS[0];
      store.apply('one', [{ op: 'log_style', id: style.id, name: style.name, source: 'preset', by: 'claude', what: 'مقدمة' }]);
      expect((await app.inject('/api/style-library/recent')).json()[0]).toMatchObject({ id: style.id, project: 'one', by: 'claude' });
      const usage = (await app.inject(`/api/style-library/${style.id}/usage`)).json();
      expect(usage[0]).toMatchObject({ project: 'one', name: 'one', what: 'مقدمة' });
      expect((await app.inject({ method: 'POST', url: '/api/style-library/recent', payload: { id: style.id, source: 'preset', project: 'two', by: 'user' } })).statusCode).toBe(200);
      expect(recent.list()).toHaveLength(2);
      expect((await app.inject({ method: 'DELETE', url: `/api/style-library/recent/${style.id}?project=one` })).statusCode).toBe(200);
      expect(recent.list()[0].project).toBe('two');
      expect((await app.inject({ method: 'DELETE', url: '/api/style-library/recent' })).statusCode).toBe(200);
      expect(recent.list()).toEqual([]); expect(store.get('one').project.stylesUsed).toHaveLength(1);
    } finally {
      await app.close(); await store.close();
      if (!relative(resolve(tmpdir()), root).startsWith('qassa-recent-')) throw Error('unsafe cleanup'); rmSync(root, { recursive: true, force: true });
    }
  });
});
