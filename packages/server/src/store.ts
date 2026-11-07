import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { EventEmitter } from 'node:events';
import { watch } from 'chokidar';
import { applyOps, defaultTracks, projectDuration, Project, type ProjectStart, type Op, type Transcript } from '@edit/shared';
import { PROJECTS_DIR } from './config.ts';
import { assertNoLink, checkedProjectDir, ProjectManagementError } from './project-paths.ts';

export const SUBDIRS = ['source', 'refs', 'analysis', 'graphics', 'luts', 'cache', 'renders'];

export function projectDir(name: string): string {
  return checkedProjectDir(PROJECTS_DIR, name);
}

interface Entry {
  project: Project;
  rev: number;
  undo: Project[];
  redo: Project[];
  lastWritten: string;
  transcripts: Map<string, Transcript | null>;
}

export interface ChangeEvent { name: string; project: Project; rev: number; author: string }

const HISTORY = 200;

/** Owns every project.json: loads, applies ops, keeps undo history, writes, notices outside edits. */
export class Store extends EventEmitter {
  private entries = new Map<string, Entry>();
  private watcher?: ReturnType<typeof watch>;

  constructor(public readonly root = PROJECTS_DIR, options: { watch?: boolean } = {}) {
    super();
    mkdirSync(root, { recursive: true });
    // someone (Claude, an editor) may edit project.json by hand: pick it up
    if (options.watch === false) return;
    this.watcher = watch(root, { depth: 1, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150 } })
      .on('change', (path) => {
        if (!path.endsWith('project.json')) return;
        const name = path.replace(/\\/g, '/').split('/').slice(-2)[0];
        const e = this.entries.get(name);
        if (!e) return;
        try {
          const text = readFileSync(join(this.dir(name), 'project.json'), 'utf8');
          if (text === e.lastWritten) return;
          const next = Project.parse(JSON.parse(text));
          this.commit(name, e, next, 'file');
        } catch (err) {
          this.emit('warning', `${name}/project.json was edited but is invalid: ${(err as Error).message}`);
        }
      });
  }

  dir(name: string) { return checkedProjectDir(this.root, name); }

  async close() { await this.watcher?.close(); }

  invalidate(name: string) {
    const dir = this.dir(name);
    for (const key of this.entries.keys()) if (relative(dir, join(this.root, key)) === '') this.entries.delete(key);
  }

  list(): { name: string; displayName: string; modified: number; media: number; duration?: number; aspect?: string; exports?: number }[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== '.trash')
      .flatMap((d) => {
        let file: string;
        try { file = join(this.dir(d.name), 'project.json'); if (!existsSync(file)) return []; }
        catch { return []; }
        let media = 0;
        let displayName = d.name;
        let duration: number | undefined, aspect: string | undefined;
        try {
          const data = JSON.parse(readFileSync(file, 'utf8'));
          media = Array.isArray(data.media) ? data.media.length : 0;
          if (typeof data.name === 'string' && data.name.trim()) displayName = data.name;
          const p = Project.safeParse(data);
          if (p.success) { duration = projectDuration(p.data); aspect = p.data.settings.aspect; }
        } catch { /* listed anyway */ }
        // finished videos in renders/ (exports and previews)
        let exports = 0;
        try { exports = readdirSync(join(this.dir(d.name), 'renders')).filter((f) => /\.(mp4|mov|mkv)$/i.test(f) && !/\.part\./i.test(f)).length; } catch { /* none yet */ }
        return [{ name: d.name, displayName, modified: statSync(file).mtimeMs, media, duration, aspect, exports }];
      })
      .sort((a, b) => b.modified - a.modified);
  }

  create(name: string, start: ProjectStart = 'video'): Project {
    const dir = this.dir(name);
    if (existsSync(join(dir, 'project.json'))) return this.get(name).project;
    for (const s of SUBDIRS) mkdirSync(join(dir, s), { recursive: true });
    const project = Project.parse({ name, createdAt: new Date().toISOString(), tracks: defaultTracks(start) });
    if (!existsSync(join(dir, 'CHANGES.md'))) writeFileSync(join(dir, 'CHANGES.md'), `# ${name} — سجل القرارات\n\n| التاريخ | من | القرار |\n|---|---|---|\n`, 'utf8');
    const e: Entry = { project, rev: 0, undo: [], redo: [], lastWritten: '', transcripts: new Map() };
    this.entries.set(name, e);
    this.write(name, e);
    this.emit('projects');
    return project;
  }

  get(name: string): Entry {
    const file = join(this.dir(name), 'project.json');
    if (!existsSync(file)) {
      this.invalidate(name);
      throw new ProjectManagementError(`project ${name} not found`, 404);
    }
    let e = this.entries.get(name);
    if (!e) {
      const text = readFileSync(file, 'utf8');
      e = { project: Project.parse(JSON.parse(text)), rev: 0, undo: [], redo: [], lastWritten: text, transcripts: new Map() };
      this.entries.set(name, e);
    }
    return e;
  }

  transcript(name: string, mediaId: string): Transcript | undefined {
    const e = this.get(name);
    if (!e.transcripts.has(mediaId)) {
      const f = join(this.dir(name), 'analysis', mediaId, 'transcript.json');
      e.transcripts.set(mediaId, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
    }
    return e.transcripts.get(mediaId) ?? undefined;
  }

  dropTranscript(name: string, mediaId: string) {
    this.entries.get(name)?.transcripts.delete(mediaId);
  }

  /** Apply an op batch atomically. Throws OpError/ZodError on bad input; nothing is written then. */
  apply(name: string, ops: Op[], author = 'user', opts: { history?: boolean; allowProjectRestore?: boolean } = {}): { project: Project; rev: number; notices: string[] } {
    const e = this.get(name);
    const notices: string[] = [];
    const next = applyOps(e.project, ops, { words: (m) => this.transcript(name, m)?.words, allowProjectRestore: opts.allowProjectRestore, report: (message) => notices.push(message) });
    this.commit(name, e, next, author, () => {
      if (opts.history !== false) {
        e.undo.push(e.project);
        if (e.undo.length > HISTORY) e.undo.shift();
        e.redo = [];
      }
    });
    for (const op of ops) if (op.op === 'log_style') {
      const use = e.project.stylesUsed.find((s) => s.id === op.id);
      if (use) this.emit('style_used', name, use);
    }
    return { project: e.project, rev: e.rev, notices };
  }

  /** A checkpoint restore is an ordinary undoable op with optimistic concurrency. */
  restoreProject(name: string, project: Project, expectedRev: number) {
    if (!Number.isSafeInteger(expectedRev) || expectedRev < 0) throw new ProjectManagementError('invalid expected revision', 400);
    if (this.get(name).rev !== expectedRev) throw new ProjectManagementError('project revision changed; reload before restoring', 409);
    const result = this.apply(name, [{ op: 'restore_project', project }], 'checkpoint', { allowProjectRestore: true });
    this.get(name).transcripts.clear();
    return result;
  }

  /** Non-undoable bookkeeping (analysis results merged into media entries, etc.). */
  mutate(name: string, fn: (p: Project) => void, author = 'system') {
    const e = this.get(name);
    const next = structuredClone(e.project);
    fn(next);
    this.commit(name, e, Project.parse(next), author);
  }

  undo(name: string): boolean {
    const e = this.get(name);
    const prev = e.undo.pop();
    if (!prev) return false;
    e.redo.push(e.project);
    this.commit(name, e, prev, 'undo');
    return true;
  }

  redo(name: string): boolean {
    const e = this.get(name);
    const next = e.redo.pop();
    if (!next) return false;
    e.undo.push(e.project);
    this.commit(name, e, next, 'redo');
    return true;
  }

  history(name: string) {
    const e = this.get(name);
    return { undo: e.undo.length, redo: e.redo.length, rev: e.rev };
  }

  private commit(name: string, e: Entry, next: Project, author: string, history?: () => void) {
    const renamed = e.project.name !== next.name;
    this.write(name, e, next);
    history?.();
    e.project = next;
    e.rev++;
    this.emit('change', { name, project: e.project, rev: e.rev, author } satisfies ChangeEvent);
    if (renamed) this.emit('projects');
  }

  private write(name: string, e: Entry, project = e.project) {
    const text = JSON.stringify(project, null, 1);
    const dir = this.dir(name), temp = join(dir, `.project-${randomUUID()}.tmp`);
    assertNoLink(temp);
    let fd: number | undefined;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, text, 'utf8');
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      assertNoLink(join(dir, 'project.json'));
      renameSync(temp, join(dir, 'project.json'));
      e.lastWritten = text;
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
}
