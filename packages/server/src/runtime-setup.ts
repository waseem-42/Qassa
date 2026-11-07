import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { OpError } from '@edit/shared';
import { DATA_DIR, DESKTOP, PYTHON, ROOT } from './config.ts';

export const runtimeDir = join(DATA_DIR, 'runtime');
export const analysisReady = () => !DESKTOP || (existsSync(join(runtimeDir, 'ready.json')) && existsSync(PYTHON) && existsSync(join(runtimeDir, 'model/model.bin')));
export const requireAnalysis = () => { if (!analysisReady()) throw new OpError('يحتاج إكمال التجهيز — افتح إعدادات قَصّة لإكمال تنزيل أدوات التحليل.'); };
type SetupState = { status: 'idle' | 'running' | 'paused' | 'error' | 'done'; stage: string; progress: number; downloaded?: number; total?: number; message?: string };
const FILES = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.json', 'preprocessor_config.json'];

/** Completed downloads/steps are checkpoints. An interrupted step retries with its local cache. */
export class RuntimeSetup {
  state: SetupState = { status: 'idle', stage: '', progress: 0 };
  private ctrl?: AbortController;
  private active?: Promise<void>;
  readonly gpu = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout?.trim() || '';
  constructor(private dir = runtimeDir) {
    try { this.state = JSON.parse(readFileSync(join(dir, 'setup.json'), 'utf8')); if (this.state.status === 'running') this.state.status = 'paused'; } catch {}
    if (analysisReady()) this.state = { status: 'done', stage: 'جاهز', progress: 1 };
    const pth = join(dir, 'python/python311._pth');
    if (DESKTOP && existsSync(pth)) writeFileSync(pth, `python311.zip\n.\nLib/site-packages\n${join(ROOT, 'analysis')}\nimport site\n`);
  }
  private update(patch: Partial<SetupState>) {
    Object.assign(this.state, patch); mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'setup.json.tmp'), JSON.stringify(this.state)); renameSync(join(this.dir, 'setup.json.tmp'), join(this.dir, 'setup.json'));
  }
  async download(url: string, dest: string, signal: AbortSignal) {
    if (existsSync(dest)) return;
    const part = `${dest}.part`; let offset = existsSync(part) ? statSync(part).size : 0;
    const head = await fetch(url, { method: 'HEAD', signal });
    if (!head.ok) throw new Error(`التنزيل تعذّر: HTTP ${head.status}`);
    const length = Number(head.headers.get('content-length'));
    if (length) {
      if (offset > length) { offset = 0; writeFileSync(part, ''); }
      while (offset < length) {
        const chunks = Array.from({ length: Math.min(4, Math.ceil((length - offset) / 1048576)) }, (_, i) => ({ start: offset + i * 1048576, end: Math.min(length - 1, offset + (i + 1) * 1048576 - 1) }));
        const results = await Promise.allSettled(chunks.map(async ({ start, end }) => {
          const response = await fetch(head.url, { headers: { Range: `bytes=${start}-${end}` }, signal });
          if (!response.ok || (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${start}-`))) throw new Error(`تعذّر استئناف التنزيل: ${response.status}`);
          if (response.status !== 206 && length > 1048576) throw new Error('الخادم لا يدعم استئناف هذا الملف؛ أعد المحاولة');
          const bytes = Buffer.from(await response.arrayBuffer());
          if (response.status === 206 && bytes.length !== end - start + 1) throw new Error('جزء التنزيل غير مكتمل');
          return { bytes, whole: response.status !== 206 };
        }));
        for (const result of results) {
          if (result.status === 'rejected') throw result.reason;
          if (result.value.whole) { writeFileSync(part, result.value.bytes); offset = result.value.bytes.length; }
          else { appendFileSync(part, result.value.bytes); offset += result.value.bytes.length; }
          this.update({ downloaded: offset, total: length });
        }
      }
      signal.throwIfAborted(); renameSync(part, dest); return;
    }
    let response = await fetch(url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal });
    if (response.status === 416) { offset = 0; response = await fetch(url, { signal }); }
    if (!response.ok || !response.body) throw new Error(`التنزيل تعذّر: HTTP ${response.status}`);
    if (response.status !== 206) offset = 0;
    else if (!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('نطاق التنزيل لا يطابق الملف الجزئي');
    const total = offset + Number(response.headers.get('content-length') || 0); let downloaded = offset, last = 0;
    const stream = Readable.fromWeb(response.body as any);
    stream.on('data', (b: Buffer) => { downloaded += b.length; if (Date.now() - last > 300) { last = Date.now(); this.update({ downloaded, total }); } });
    await pipeline(stream, createWriteStream(part, { flags: offset ? 'a' : 'w' }), { signal });
    if (total && downloaded !== total) throw new Error('التنزيل غير مكتمل؛ اضغط استئناف');
    renameSync(part, dest); this.update({ downloaded, total });
  }
  private command(exe: string, args: string[], signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const p = spawn(exe, args, { cwd: this.dir, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } }); let error = '';
      const stop = () => { if (p.pid && process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill(); };
      signal.addEventListener('abort', stop, { once: true });
      for (const stream of [p.stdout, p.stderr]) stream.on('data', (b) => {
        error = (error + b).slice(-3000);
        const progress = [...error.matchAll(/Progress (\d+) of (\d+)/g)].at(-1);
        this.update({ message: String(b).trim().slice(-350), ...(progress ? { downloaded: Number(progress[1]), total: Number(progress[2]) } : {}) });
      });
      p.once('error', reject); p.once('close', (code) => { signal.removeEventListener('abort', stop); code === 0 && !signal.aborted ? resolve() : reject(new Error(error || `exit ${code}`)); });
    });
  }
  start() {
    if (this.active || analysisReady()) return;
    this.ctrl = new AbortController(); const signal = this.ctrl.signal;
    this.active = this.run(signal).catch((e: Error) => this.update({ status: signal.aborted ? 'paused' : 'error', message: signal.aborted ? 'متوقف مؤقتًا — الملفات المكتملة محفوظة' : e.message.slice(-1000) })).finally(() => { this.active = undefined; });
  }
  pause() { this.ctrl?.abort(); }
  private async run(signal: AbortSignal) {
    this.update({ status: 'running', stage: 'Python 3.11', progress: .02, downloaded: 0, total: 0, message: '' });
    const archive = join(this.dir, 'python.zip'), pyDir = join(this.dir, 'python'), py = join(pyDir, 'python.exe');
    await this.download('https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip', archive, signal);
    if (!existsSync(join(this.dir, 'python-extracted'))) {
      // Extract to our private runtime only; Windows supplies Expand-Archive.
      const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
      await this.command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(pyDir)} -Force`], signal);
      mkdirSync(join(pyDir, 'Lib/site-packages'), { recursive: true });
      writeFileSync(join(this.dir, 'python-extracted'), '3.11.9');
    }
    writeFileSync(join(pyDir, 'python311._pth'), `python311.zip\n.\nLib/site-packages\n${join(ROOT, 'analysis')}\nimport site\n`);
    this.update({ stage: 'مدير الحزم', progress: .08, downloaded: 0, total: 0 });
    const getPip = join(this.dir, 'get-pip.py'); await this.download('https://bootstrap.pypa.io/get-pip.py', getPip, signal);
    if (!existsSync(join(this.dir, 'pip-ready'))) { await this.command(py, [getPip, '--disable-pip-version-check'], signal); writeFileSync(join(this.dir, 'pip-ready'), '1'); }
    this.update({ stage: this.gpu ? 'Whisper ومكتبات CUDA' : 'Whisper — CPU int8', progress: .15, downloaded: 0, total: 0 });
    if (!existsSync(join(this.dir, 'packages-ready'))) {
      await this.command(py, ['-m', 'pip', 'install', '--progress-bar', 'raw', '--disable-pip-version-check', '--only-binary=:all:', '--cache-dir', join(this.dir, 'pip-cache'), 'faster-whisper>=1.2,<2', 'scenedetect[opencv-headless]>=0.6,<0.7', 'opencv-python-headless>=4.10,<5', 'numpy>=2,<3', ...(this.gpu ? ['nvidia-cublas-cu12>=12,<13', 'nvidia-cudnn-cu12>=9,<10'] : [])], signal);
      writeFileSync(join(this.dir, 'packages-ready'), '1');
    }
    this.update({ stage: 'نموذج Whisper large-v3', progress: .55, downloaded: 0, total: 0, message: 'نحو 3.1 GB — يمكن إيقاف التنزيل واستئنافه' });
    const model = join(this.dir, 'model'); mkdirSync(model, { recursive: true });
    // A fixed upstream revision prevents mixing model files across resumes.
    const revisionFile = join(this.dir, 'model-revision');
    const revision = existsSync(revisionFile) ? readFileSync(revisionFile, 'utf8') : (await (await fetch('https://huggingface.co/api/models/Systran/faster-whisper-large-v3', { signal })).json() as { sha: string }).sha;
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('تعذّر تحديد نسخة النموذج'); writeFileSync(revisionFile, revision);
    for (const file of FILES) await this.download(`https://huggingface.co/Systran/faster-whisper-large-v3/resolve/${revision}/${file}`, join(model, file), signal);
    this.update({ stage: 'فحص التجهيز', progress: .95, downloaded: 0, total: 0 });
    await this.command(py, ['-c', `import numpy,cv2,scenedetect; from faster_whisper import WhisperModel; WhisperModel(${JSON.stringify(model)},device='cpu',compute_type='int8')`], signal);
    writeFileSync(join(this.dir, 'ready.json'), JSON.stringify({ python: '3.11.9', model: revision, gpu: this.gpu, at: new Date().toISOString() }));
    this.update({ status: 'done', stage: 'جاهز', progress: 1, message: '' });
  }
}

export function registerRuntime(app: FastifyInstance) {
  const setup = DESKTOP ? new RuntimeSetup() : undefined;
  app.get('/api/runtime', async () => {
    const found = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [process.env.EDIT_CLAUDE || 'claude'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const command = process.env.EDIT_MCP_COMMAND || '';
    return { desktop: DESKTOP, ready: analysisReady(), dataDir: DATA_DIR, gpu: setup?.gpu, estimatedGB: setup?.gpu ? 5 : 3.5, state: setup?.state, claude: found.status === 0, claudeCommand: command ? `claude mcp add --transport stdio --scope user edit-tool -- cmd /d /c "${command}"` : 'npm run mcp', resources: ROOT };
  });
  app.post<{ Body: { action: string } }>('/api/runtime/setup', async (req) => {
    if (!setup) throw new OpError('التجهيز التلقائي متاح في تطبيق Windows');
    if (req.body.action === 'pause') setup.pause(); else if (req.body.action === 'start') setup.start(); else throw new OpError('unknown setup action');
    return setup.state;
  });
  app.addHook('onClose', async () => setup?.pause());
}
