import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Store } from '../src/store.ts';
import { AgentEdits } from '../src/agent-edits.ts';

const root = mkdtempSync(join(tmpdir(), 'qassa-agent-edits-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const setup = (name: string) => {
  const store = new Store(join(root, name), { watch: false });store.create('p');
  store.apply('p', [{ op: 'add_text', text: 'قبل', start: 4, duration: 3 }]);
  return { store, edits: new AgentEdits(store), clipId: store.get('p').project.clips[0].id };
};

it('restores several task batches in one undoable operation and groups navigable changes', async () => {
  const { store, edits, clipId } = setup('plain'), before = structuredClone(store.get('p').project);
  edits.begin('p', 't');
  await edits.run('t', async () => { await Promise.resolve();store.apply('p', [{ op: 'update_clip', clipId, patch: { text: 'بعد' } }]); });
  edits.run('t', () => store.apply('p', [{ op: 'set_timing', clipId, start: 8 }]));
  const status = edits.finish('p', 't');
  expect(status.available).toBe(true);expect(status.changes).toHaveLength(2);expect(status.changes[0].clipIds).toContain(clipId);
  const undo = store.history('p').undo;edits.undo('p', 't');
  expect(store.get('p').project).toEqual(before);expect(store.history('p').undo).toBe(undo + 1);
  expect(edits.status('p', 't').undone).toBe(true);store.undo('p');expect(store.get('p').project.clips[0].text).toBe('بعد');
});

it('refuses with user edits during or after a task, without changing their work', () => {
  for (const during of [true, false]) {
    const { store, edits, clipId } = setup('user-' + during);edits.begin('p', 't');
    edits.run('t', () => store.apply('p', [{ op: 'update_clip', clipId, patch: { text: 'AI' } }]));
    if (!during) edits.finish('p', 't');
    store.apply('p', [{ op: 'update_clip', clipId, patch: { text: 'المستخدم' } }]);
    if (during) { edits.run('t', () => store.apply('p', [{ op: 'set_timing', clipId, start: 9 }]));edits.finish('p', 't'); }
    const before = structuredClone(store.get('p').project);expect(() => edits.undo('p', 't')).toThrow(/خارج هذه المهمة/);
    expect(store.get('p').project).toEqual(before);
  }
});

it('propagates the boundary through a Fastify request and rejects unknown or wrong-project task tags', async () => {
  const { store, edits, clipId } = setup('http'), app = Fastify();store.create('other');edits.begin('p', 't');
  app.addHook('onRequest', (req, _reply, done) => edits.run(req.headers['x-qassa-task'] as string, done));
  app.post('/', async () => { await Promise.resolve();return store.apply('p', [{ op: 'update_clip', clipId, patch: { text: 'HTTP' } }]); });
  await app.inject({ method: 'POST', url: '/', headers: { 'x-qassa-task': 't' } });
  expect(edits.finish('p', 't').available).toBe(true);
  expect(edits.status('other', 't').available).toBe(false);
  edits.begin('p', 'second');await app.inject({ method: 'POST', url: '/', headers: { 'x-qassa-task': 'unknown' } });
  expect(edits.finish('p', 'second').available).toBe(false);await app.close();
});
