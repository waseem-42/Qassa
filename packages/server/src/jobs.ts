import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { makeId } from '@edit/shared';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { requireAnalysis } from './runtime-setup.ts';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface RenderMetadata {
  rev: number;
  snapshotId: string;
  quality: 'preview' | 'final';
  output: string;
}

export interface Job {
  id: string;
  kind: string;
  project: string;
  label: string;
  status: JobStatus;
  stage?: string;
  progress: number;
  message?: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  render?: RenderMetadata;
  /** comments an AI task works on */
  notes?: string[];
  /** an AI task proposing visual ideas */
  ideas?: boolean;
  mediaId?: string;
  steps?: string[];
}

export interface JobContext {
  job: Job;
  signal: AbortSignal;
  update: (patch: Partial<Pick<Job, 'stage' | 'progress' | 'message'>>) => void;
}

type Runner = (ctx: JobContext) => Promise<unknown>;

/** One queue for everything that uses the GPU/CPU heavily: jobs run one at a time. */
export class Jobs extends EventEmitter {
  private jobs = new Map<string, Job>();
  private queue: { job: Job; run: Runner; ctrl: AbortController }[] = [];
  private running?: { job: Job; ctrl: AbortController };

  constructor(private file?: string) {
    super();
    if (!file) return;
    try {
      for (const job of JSON.parse(readFileSync(file, 'utf8')) as Job[]) {
        if (job.status === 'queued' || job.status === 'running') Object.assign(job, { status: 'error', error: 'توقف الخادم قبل اكتمال المهمة. أعد تشغيلها.', finishedAt: Date.now() });
        this.jobs.set(job.id, job);
      }
      this.persist();
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    this.on('job', () => this.persist());
  }
  private persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)));
    renameSync(`${this.file}.tmp`, this.file);
  }

  add(kind: string, project: string, label: string, run: Runner, metadata?: Pick<Job, 'render' | 'notes' | 'ideas' | 'mediaId' | 'steps'>): Job {
    const job: Job = { id: makeId('j'), kind, project, label, status: 'queued', progress: 0, createdAt: Date.now(), ...(metadata?.render ? { render: structuredClone(metadata.render) } : {}), ...(metadata?.notes ? { notes: [...metadata.notes] } : {}), ...(metadata?.ideas ? { ideas: true } : {}), ...(metadata?.mediaId ? { mediaId: metadata.mediaId } : {}), ...(metadata?.steps ? { steps: [...metadata.steps] } : {}) };
    this.jobs.set(job.id, job);
    this.queue.push({ job, run, ctrl: new AbortController() });
    this.emit('job', job);
    queueMicrotask(() => this.pump());
    return job;
  }

  get(id: string) {
    return this.jobs.get(id);
  }

  hasActive(project: string): boolean {
    const key = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name;
    return [...this.jobs.values()].some((job) => key(job.project) === key(project) && (job.status === 'queued' || job.status === 'running'));
  }

  list(project?: string): Job[] {
    return [...this.jobs.values()].filter((j) => !project || j.project === project).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  }

  cancel(id: string): boolean {
    const q = this.queue.findIndex((x) => x.job.id === id);
    if (q >= 0) {
      const [x] = this.queue.splice(q, 1);
      this.finish(x.job, 'cancelled');
      return true;
    }
    if (this.running?.job.id === id) {
      this.running.ctrl.abort();
      return true;
    }
    return false;
  }

  /** Resolve when the job finishes or the timeout passes, whichever is first. */
  wait(id: string, timeoutMs: number): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job || ['done', 'error', 'cancelled'].includes(job.status)) return Promise.resolve(job);
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.off('job', on); resolve(this.jobs.get(id)); }, timeoutMs);
      const on = (j: Job) => {
        if (j.id === id && ['done', 'error', 'cancelled'].includes(j.status)) {
          clearTimeout(t);
          this.off('job', on);
          resolve(j);
        }
      };
      this.on('job', on);
    });
  }

  private async pump() {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    const { job, run, ctrl } = next;
    this.running = { job, ctrl };
    job.status = 'running';
    this.emit('job', job);
    let last = 0;
    const update: JobContext['update'] = (patch) => {
      Object.assign(job, patch);
      const now = Date.now();
      // throttle progress broadcasts
      if (now - last > 150 || patch.stage) {
        last = now;
        this.emit('job', job);
      }
    };
    try {
      job.result = await run({ job, signal: ctrl.signal, update });
      this.finish(job, ctrl.signal.aborted ? 'cancelled' : 'done');
    } catch (e) {
      job.error = (e as Error).message;
      this.finish(job, ctrl.signal.aborted ? 'cancelled' : 'error');
    } finally {
      this.running = undefined;
      this.pump();
    }
  }

  private finish(job: Job, status: JobStatus) {
    job.status = status;
    job.finishedAt = Date.now();
    if (status === 'done') job.progress = 1;
    this.emit('job', job);
  }
}

/** Run a Python analysis script that speaks the "@@ {json}" line protocol. */
export function runPython(python: string, args: string[], cwd: string, ctx: JobContext, weights?: Record<string, number>): Promise<any> {
  requireAnalysis();
  return new Promise((resolve, reject) => {
    const proc = spawn(python, ['-u', ...args], { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    ctx.signal.addEventListener('abort', () => proc.kill(), { once: true });
    let result: unknown, err = '', buf = '';
    const stageOrder = weights ? Object.keys(weights) : [];
    const total = weights ? Object.values(weights).reduce((a, b) => a + b, 0) : 1;
    proc.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('@@ ')) continue;
        try {
          const msg = JSON.parse(line.slice(3));
          if ('result' in msg) result = msg.result;
          else if (msg.stage) {
            let p = msg.progress ?? 0;
            if (weights && msg.stage in weights) {
              const before = stageOrder.slice(0, stageOrder.indexOf(msg.stage)).reduce((a, s) => a + weights[s], 0);
              p = (before + weights[msg.stage] * p) / total;
            }
            ctx.update({ stage: msg.stage, progress: p, ...(msg.msg ? { message: msg.msg } : {}) });
          }
        } catch { /* ignore malformed lines */ }
      }
    });
    proc.stderr.setEncoding('utf8').on('data', (c: string) => (err = (err + c).slice(-6000)));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (ctx.signal.aborted) return reject(new Error('cancelled'));
      if (code !== 0) return reject(new Error(err.trim().split('\n').slice(-6).join('\n') || `python exited ${code}`));
      resolve(result);
    });
  });
}
