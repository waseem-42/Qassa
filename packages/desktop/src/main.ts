import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const data = resolve(process.env.EDIT_DATA_DIR || join(app.getPath('documents'), 'Qassa'));
mkdirSync(join(data, 'logs'), { recursive: true });
app.setPath('userData', join(data, 'desktop'));
app.setPath('sessionData', join(data, 'desktop'));
app.setPath('crashDumps', join(data, 'logs/crashes'));
const log = (message: string) => appendFileSync(join(data, 'logs/desktop.log'), `${new Date().toISOString()} ${message}\n`);
let win: BrowserWindow | undefined, child: ChildProcess | undefined, quitting = false, origin = '', restarts = 0;
const resources = app.isPackaged ? join(process.resourcesPath, 'qassa') : resolve(__dirname, '../resources');

function stopTree() {
  if (!child?.pid) return;
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); child = undefined;
}
async function port() {
  const probe = createServer(); await new Promise<void>((done, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', done); });
  const chosen = (probe.address() as { port: number }).port; await new Promise<void>((done) => probe.close(() => done())); return chosen;
}
function writeMcp() {
  const env = { ELECTRON_RUN_AS_NODE: '1', EDIT_DESKTOP: '1', EDIT_DATA_DIR: data, EDIT_RESOURCES_DIR: resources };
  writeFileSync(join(data, '.mcp.json'), JSON.stringify({ mcpServers: { 'edit-tool': { command: process.execPath, args: [join(resources, 'mcp.mjs')], env } } }, null, 2));
  // cmd launcher needs no system Node and reads the live port on every request.
  const lines = ['@echo off', 'chcp 65001 >nul', ...Object.entries(env).map(([key, value]) => `set "${key}=${value.replaceAll('%', '%%')}"`), `"${process.execPath.replaceAll('%', '%%')}" "${join(resources, 'mcp.mjs').replaceAll('%', '%%')}"`];
  writeFileSync(join(data, 'qassa-mcp.cmd'), lines.join('\r\n'), 'utf8');
}
async function server() {
  const chosen = await port(); origin = `http://127.0.0.1:${chosen}`; writeMcp();
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', EDIT_NODE_EXE: process.execPath, EDIT_SERVER_SCRIPT: join(resources, 'server.mjs'), EDIT_PARENT_PID: String(process.pid), EDIT_LOG_DIR: join(data, 'logs'), EDIT_DESKTOP: '1', EDIT_DATA_DIR: data, EDIT_RESOURCES_DIR: resources, EDIT_PORT: String(chosen), EDIT_MCP_CONFIG: join(data, '.mcp.json'), EDIT_MCP_COMMAND: join(data, 'qassa-mcp.cmd'), FFMPEG_PATH: join(resources, 'bin/ffmpeg.exe'), FFPROBE_PATH: join(resources, 'bin/ffprobe.exe'), PATH: `${join(resources, 'bin')};${join(data, 'runtime/python')};${process.env.PATH || ''}`, PYTHONDONTWRITEBYTECODE: '1', HF_HOME: join(data, 'runtime/hf-cache'), PIP_CACHE_DIR: join(data, 'runtime/pip-cache') };
  const logName = `server-${Date.now()}`;
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(resources, 'supervisor.ps1')], { cwd: data, env: { ...env, EDIT_SERVER_LOG: logName }, windowsHide: true, stdio: 'ignore' });
  const current = child;
  current.on('error', (e) => log(e.message));
  current.once('exit', (code) => {
    log(`server supervisor exited ${code}`);
    if (quitting || child !== current) return;
    child = undefined;
    if (++restarts > 3) { void dialog.showMessageBox({ type: 'error', title: 'قَصّة', message: 'الخادم يتوقف باستمرار. أعد فتح التطبيق وراجع مجلد logs.', detail: data }); return; }
    void restart();
  });
  for (let i = 0; i < 240; i++) {
    if (quitting || current.exitCode !== null) throw new Error('توقف الخادم أثناء التشغيل');
    const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json()).catch(() => undefined);
    if (health?.app === 'qassa' && resolve(health.dataDir) === data) {
      writeFileSync(join(data, '.port.tmp'), String(chosen)); renameSync(join(data, '.port.tmp'), join(data, '.port')); log(`ready ${origin}`); return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('تأخر تشغيل الخادم؛ راجع logs.');
}
async function restart() {
  try { await server(); if (win) { await win.loadURL(origin); void dialog.showMessageBox(win, { type: 'warning', title: 'قَصّة', message: 'أُعيد تشغيل الخادم بعد توقفه.', detail: 'المهام التي انقطعت مسجلة كمهام فاشلة في قائمة المهام؛ يمكنك إعادة تشغيلها. المونتاج المحفوظ باقٍ.' }); } }
  catch (e) { log(String(e)); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win?.isMinimized()) win.restore(); win?.focus(); });
  app.on('before-quit', () => { quitting = true; stopTree(); try { if (existsSync(join(data, '.port')) && readFileSync(join(data, '.port'), 'utf8') === origin.split(':').pop()) rmSync(join(data, '.port')); } catch {} });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      await server();
      win = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 650, title: 'قَصّة', icon: join(resources, 'qassa.ico'), show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      win.on('page-title-updated', (e) => { e.preventDefault(); win?.setTitle('قَصّة'); });
      win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
      win.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origin) e.preventDefault(); });
      win.once('ready-to-show', () => { if (process.env.EDIT_DESKTOP_TEST !== '1') win?.show(); }); await win.loadURL(origin);
    } catch (e) { log(String(e)); dialog.showErrorBox('تعذّر فتح قَصّة', `${String(e)}\n${join(data, 'logs')}`); app.quit(); }
  });
}
