// End-to-end MCP smoke check against an isolated, disposable project directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const temp = mkdtempSync(join(artifacts, 'mcp-check-'));
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const env = { ...process.env, EDIT_PORT: String(port), EDIT_PROJECTS_DIR: temp };
const backend = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
backend.stderr.on('data', (s) => { log = (log + s).slice(-4000); });
backend.stdout.on('data', () => {});
const client = new Client({ name: 'project-management-check', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'packages/mcp/src/index.ts'], cwd: root, env, stderr: 'pipe' });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.ok).catch(() => false);
    if (ready || backend.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Isolated server did not start: ${log}`);
  await client.connect(transport);
  const invoke = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.content.find((item) => item.type === 'text').text;
  };
  const tools = await client.listTools();
  assert.equal(tools.tools.find((t) => t.name === 'render').inputSchema.properties.marked.type, 'boolean');
  for (const name of ['project_rename', 'project_trash', 'projects_trash_list', 'project_restore', 'checkpoint_create', 'checkpoint_restore', 'checkpoints_list', 'project_state', 'render_preflight']) assert.ok(tools.tools.some((t) => t.name === name), name);
  await invoke('project_create', { name: 'mcp-check' });
  const renamed = JSON.parse(await invoke('project_rename', { project: 'mcp-check', name: 'تجربة صانع محتوى' }));
  assert.equal(renamed.project, 'mcp-check');
  assert.equal(renamed.displayName, 'تجربة صانع محتوى');
  assert.equal(JSON.parse(await invoke('projects_list'))[0].displayName, renamed.displayName);
  const checkpoint = JSON.parse(await invoke('checkpoint_create', { project: 'mcp-check', label: 'قبل تجربة التعديلات' })).checkpoint;
  await invoke('project_rename', { project: 'mcp-check', name: 'اسم مؤقت' });
  const stale = await client.callTool({ name: 'checkpoint_restore', arguments: { project: 'mcp-check', id: checkpoint.id, expectedRev: renamed.rev } });
  assert.equal(stale.isError, true);
  const state = JSON.parse(await invoke('project_state', { project: 'mcp-check' }));
  assert.equal(state.project.name, 'اسم مؤقت');
  const recovered = JSON.parse(await invoke('checkpoint_restore', { project: 'mcp-check', id: checkpoint.id, expectedRev: state.rev }));
  assert.ok(recovered.safetyCheckpoint.id);
  assert.equal(JSON.parse(await invoke('project_state', { project: 'mcp-check' })).project.name, renamed.displayName);
  assert.equal(JSON.parse(await invoke('checkpoints_list', { project: 'mcp-check' })).length, 2);
  await invoke('edit', { project: 'mcp-check', ops: [{ op: 'set_marks', in: 25, out: 10 }] });
  assert.deepEqual(JSON.parse(await invoke('project_state', { project: 'mcp-check' })).project.settings.marks, { in: 10, out: 25 });
  assert.match(await invoke('project_summary', { project: 'mcp-check' }), /In=10 Out=25.*marked:true/);
  const preflight = JSON.parse(await invoke('render_preflight', { project: 'mcp-check', quality: 'preview' }));
  assert.equal(preflight.ready, false);
  assert.ok(preflight.blockers.length > 0);
  const deleted = JSON.parse(await invoke('project_trash', { project: 'mcp-check' }));
  assert.equal(JSON.parse(await invoke('projects_list')).length, 0);
  assert.equal(JSON.parse(await invoke('projects_trash_list'))[0].id, deleted.trashed.id);
  const restored = JSON.parse(await invoke('project_restore', { id: deleted.trashed.id }));
  assert.equal(restored.project, 'mcp-check');
  assert.equal(restored.displayName, renamed.displayName);
  assert.equal(JSON.parse(await invoke('projects_trash_list')).length, 0);
  const missing = await client.callTool({ name: 'project_trash', arguments: { project: 'missing' } });
  assert.equal(missing.isError, true);
  assert.equal(JSON.parse(await invoke('checkpoints_list', { project: 'mcp-check' })).length, 2);
  console.log('PASS: MCP discovery, create, Unicode rename, stable ID, checkpoints, stale restore rejection, safety checkpoint, marks/summary/render schema, preflight blockers, trash, restore, error propagation.');
} finally {
  await client.close();
  if (backend.exitCode === null) {
    const stopped = new Promise((done) => backend.once('exit', done));
    backend.kill();
    await stopped;
  }
  // The only deleted tree is the unique directory this script created above.
  assert.equal(dirname(temp), artifacts);
  rmSync(temp, { recursive: true, force: true });
}
