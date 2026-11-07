import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jobs } from '../src/jobs.ts';
import { RuntimeSetup } from '../src/runtime-setup.ts';
import { desktopConnection } from '../../mcp/src/connection.ts';

const roots: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'qassa-runtime-')); roots.push(dir); return dir; };
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('recovers interrupted heavy and AI jobs as explicit failures and retains finished results', async () => {
  const file = join(temp(), 'jobs.json'), jobs = new Jobs(file);
  const pending = jobs.add('render', 'qa', 'preview', () => new Promise(() => {}));
  await Promise.resolve();
  const recovered = new Jobs(file);
  expect(recovered.get(pending.id)).toMatchObject({ status: 'error', error: expect.stringContaining('توقف الخادم') });
  const done = recovered.add('analyze', 'qa', 'analysis', async () => ({ words: 3 }));
  await recovered.wait(done.id, 1000);
  expect(new Jobs(file).get(done.id)).toMatchObject({ status: 'done', result: { words: 3 } });
});

it('desktop MCP follows the live .port and rejects invalid/missing ports without spawning another server', () => {
  const dir = temp(), env = { EDIT_DESKTOP: '1', EDIT_DATA_DIR: dir };
  expect(() => desktopConnection(env)).toThrow('افتح تطبيق');
  writeFileSync(join(dir, '.port'), '4318'); expect(desktopConnection(env)?.base).toBe('http://127.0.0.1:4318');
  writeFileSync(join(dir, '.port'), '5522'); expect(desktopConnection(env)?.base).toBe('http://127.0.0.1:5522');
  writeFileSync(join(dir, '.port'), 'evil:80'); expect(() => desktopConnection(env)).toThrow('invalid');
  expect(desktopConnection({ EDIT_PORT: '4317' }, dir)).toBeUndefined();
});

it('resumes an interrupted file with HTTP Range and restarts safely when a server ignores Range', async () => {
  const body = Buffer.from('a complete download'), ranges: string[] = [];
  let ignoreRange = false;
  const server = createServer((req, res) => {
    const range = req.headers.range; ranges.push(range ?? 'none');
    const offset = range && !ignoreRange ? Number(range.match(/\d+/)![0]) : 0;
    if (offset) res.writeHead(206, { 'content-range': `bytes ${offset}-${body.length - 1}/${body.length}`, 'content-length': body.length - offset });
    else res.writeHead(200, { 'content-length': body.length });
    res.end(body.subarray(offset));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir = temp(), setup = new RuntimeSetup(dir), url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const name of ['resume', 'restart']) {
      const file = join(dir, name); writeFileSync(`${file}.part`, body.subarray(0, 4));
      await setup.download(url, file, new AbortController().signal); expect(readFileSync(file)).toEqual(body); ignoreRange = true;
    }
    expect(ranges).toEqual(['none', `bytes=4-${body.length - 1}`, 'none', `bytes=4-${body.length - 1}`]);
  } finally { await new Promise<void>((r) => server.close(() => r())); }
});
