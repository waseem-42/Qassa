import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { applyOps, markedRange, projectDuration, type Clip, type ExportSettings, type Op, type Project, type ProjectStart, type Shot, type Transcript } from '@edit/shared';
import { api, projectPath } from './api.ts';
import { resumeAudio } from './audio.ts';
import { useFavorites } from './favorites.ts';
import type { ExportQuality } from './export.ts';
import { lookOf, pasteLookOps, type Look } from './look.ts';
import { duplicateOps, pasteOps } from './clipboard.ts';
import { titlePlan } from './title.ts';
import { useStartGuide } from './start-guide.ts';

export interface Job {
  mediaId?: string; steps?: string[];
  id: string; kind: string; project: string; label: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  stage?: string; progress: number; message?: string; result?: any; error?: string; createdAt: number; render?: RenderVersion; notes?: string[]; ideas?: boolean;
}
export interface RenderVersion { rev: number; snapshotId: string; quality: 'preview' | 'final'; output: string; export?: ExportSettings; range?: [number, number]; srt?: string }
export interface Checkpoint { id: string; label: string; createdAt: string; sourceRev: number; kind: 'manual' | 'before_restore' }

export interface Peaks { rate: number; data: number[] }
export interface Thumbs { interval: number; w: number; h: number; cols: number; rows: number; count: number; sheets: string[] }
export interface Analysis { peaks?: Peaks; thumbs?: Thumbs; shots?: Shot[] }
/** A home-page folder: a big project holding smaller ones, with its notes and shared files (server folders.ts). */
export interface ProjectFolder { id: string; name: string; notes: string; projects: string[]; createdAt: string; modified: number; files: { name: string; size: number; modified: number }[] }
export interface ProjectSummary { name: string; displayName?: string; modified: number; media: number; duration?: number; thumbnail?: string; aspect?: string; exports?: number }
export interface TrashedProject { id: string; name: string; displayName?: string; deletedAt: string }

interface State {
  projects: ProjectSummary[];
  folders: ProjectFolder[];
  trash: TrashedProject[];
  projectsLoaded: boolean;
  projectsError?: string;
  name?: string;
  project?: Project;
  rev: number;
  history: { undo: number; redo: number };
  jobs: Record<string, Job>;
  /** queued/running jobs of every project, for the projects page */
  activeJobs: Record<string, Job>;
  transcripts: Record<string, Transcript | null>;
  analysis: Record<string, Analysis>;
  checkpoints: Checkpoint[];
  time: number;
  playing: boolean;
  playRange?: [number, number];
  rangeDeletePrompt: boolean;
  playMarked(): void;
  deleteMarkedRange(confirmed?: boolean): Promise<void>;
  selected: string[];
  editText?: string;
  addTitle(): Promise<void>;
  zoom: number; // px per second on the timeline
  /** the magnet: drags catch on edges (timeline) and guides (preview) */
  magnet: boolean;
  largeWave: boolean;
  setLargeWave(value: boolean): void;
  /** preview playback speed (1 / 1.5 / 2): reviewing only, never the export */
  rate: number;
  cycleRate(): void;
  setMagnet(on: boolean): void;
  /** a clip's look, copied to paste onto others */
  look?: Look;
  copyLook(clipId?: string): void;
  pasteLook(ids?: string[]): Promise<void>;
  /** whole clips copied (Ctrl+C) to paste at the playhead (Ctrl+V) */
  clipboard?: Clip[];
  copyClips(): void;
  pasteClips(): Promise<void>;
  duplicateClips(): Promise<void>;
  /** an edit that needs a file made first: hold the frame at the playhead, or play the clip backwards */
  clipTool(clipId: string, tool: 'freeze' | 'reverse', body?: { at?: number; duration?: number }): Promise<void>;
  toast?: { text: string; kind: 'error' | 'info'; at: number };
  lastRender?: { url: string; output: string; rev?: number; snapshotId?: string; quality?: 'preview' | 'final' };
  connection: 'connecting' | 'connected' | 'disconnected';
  /** the tools panel's page */
  panel: 'text' | 'inspect' | 'notes' | 'assistant';
  /** side panels: tools (assistant · text · properties · comments) beside the rail, media across the video */
  panels: { tools: boolean; media: boolean };
  mediaOverlay: boolean;
  /** open a side panel; on narrow screens the library overlays the workspace */
  showPanel(which: 'tools' | 'media', on: boolean): void;
  stylesOpen: boolean;
  styleTarget?: { id: string; source: 'preset' | 'saved' | 'library' };
  openStyle(id: string, source: 'preset' | 'saved' | 'library'): void;
  setStylesOpen(open: boolean): void;
  /** a comment being written at a moment (or range) of the timeline */
  noteDraft?: { at: number; end?: number };
  focusNote?: string;
  /** picking elements inside a graphic on the preview: its clip, and the element chosen (a selector) */
  graphicPick?: { clipId: string; target?: string; label?: string };
  setGraphicPick(p?: State['graphicPick']): void;

  loadProjects(): Promise<void>;
  loadTrash(): Promise<void>;
  loadActiveJobs(): Promise<void>;
  renameProject(name: string, displayName: string): Promise<void>;
  deleteProject(name: string): Promise<TrashedProject>;
  restoreProject(id: string): Promise<void>;
  loadCheckpoints(): Promise<void>;
  saveCheckpoint(label: string): Promise<Checkpoint>;
  restoreCheckpoint(id: string, expectedRev: number): Promise<Checkpoint>;
  startRender(quality: ExportQuality, expectedRev: number, settings?: ExportSettings): Promise<RenderVersion>;
  open(name: string): Promise<void>;
  close(): void;
  /** `displayName` when the title the user typed differs from the folder name */
  /** folder: a home-page folder id the new project joins */
  create(name: string, displayName?: string, start?: ProjectStart, folder?: string): Promise<void>;
  ops(ops: Op[]): Promise<boolean>;
  /** Show ops locally without saving (slider drags); commit() saves one undo step. */
  preview(ops: Op[]): void;
  commit(ops: Op[]): Promise<boolean>;
  draftBase?: Project;
  undo(): Promise<void>;
  redo(): Promise<void>;
  seek(t: number): void;
  setPlaying(p: boolean): void;
  select(ids: string[]): void;
  setZoom(z: number): void;
  notify(text: string, kind?: 'error' | 'info'): void;
  loadMediaData(mediaId: string): Promise<void>;
  setPanel(panel: State['panel']): void;
  /** start writing a comment at t (default: the playhead) */
  startNote(at?: number, end?: number): void;
  setNoteDraft(d?: State['noteDraft']): void;
  showNote(id: string): void;
}

let openSequence = 0, projectsSequence = 0, trashSequence = 0, checkpointsSequence = 0;
/** wide enough for the tools panel, the video and the media panel side by side */
export const BOTH_PANELS = '(min-width: 1600px)';
const bothFit = () => typeof matchMedia === 'function' && matchMedia(BOTH_PANELS).matches;
function savedPanels(): State['panels'] {
  try {
    const v = JSON.parse(localStorage.getItem('panels') ?? 'null');
    if (typeof v?.tools === 'boolean' && typeof v?.media === 'boolean') return v;
  } catch { /* private mode */ }
  return { tools: true, media: true };
}
export const PREVIEW_RATES = [1, 1.5, 2];

export const useStore = create<State>((set, get) => ({
  projects: [],
  folders: [],
  trash: [],
  projectsLoaded: false,
  rev: 0,
  history: { undo: 0, redo: 0 },
  jobs: {},
  activeJobs: {},
  transcripts: {},
  analysis: {},
  checkpoints: [],
  time: 0,
  playing: false,
  rangeDeletePrompt: false,
  playMarked() {
    const p = get().project, range = p && markedRange(p);
    if (!p || !range || Math.min(range[1], projectDuration(p)) <= range[0]) return get().notify('حدّد بداية ونهاية داخل المشروع بـ I وO');
    resumeAudio();
    set({ time: range[0], playRange: [range[0], Math.min(range[1], projectDuration(p))], playing: true });
  },
  async deleteMarkedRange(confirmed = false) {
    const p = get().project, range = p && markedRange(p);
    if (!p || !range || Math.min(range[1], projectDuration(p)) <= range[0]) return;
    let seen = false; try { seen = localStorage.getItem('qassa.rangeDeleteHint') === '1'; } catch {}
    if (!confirmed && !seen) { set({ rangeDeletePrompt: true }); return; }
    if (confirmed) { try { localStorage.setItem('qassa.rangeDeleteHint', '1'); } catch {} }
    set({ rangeDeletePrompt: false, playing: false, playRange: undefined });
    if (await get().ops([{ op: 'delete_range', start: range[0], end: range[1] }, { op: 'set_marks', in: null, out: null }])) { get().select([]); get().seek(range[0]); }
  },
  selected: [],
  zoom: 40,
  magnet: (() => { try { return localStorage.getItem('qassa.magnet') !== '0'; } catch { return true; } })(),
  largeWave: (() => { try { return localStorage.getItem('qassa.largeWave') === '1'; } catch { return false; } })(),
  rate: 1,
  cycleRate() {
    const rate = PREVIEW_RATES[(PREVIEW_RATES.indexOf(get().rate) + 1) % PREVIEW_RATES.length];
    set({ rate });
    get().notify(rate === 1 ? 'المعاينة بالسرعة العادية' : `المعاينة أسرع ×${rate} — التصدير ما يتغير`, 'info');
  },
  setLargeWave(largeWave) {
    try { localStorage.setItem('qassa.largeWave', largeWave ? '1' : '0'); } catch { /* this session only */ }
    set({ largeWave });
  },
  setMagnet(magnet) {
    try { localStorage.setItem('qassa.magnet', magnet ? '1' : '0'); } catch { /* this session only */ }
    set({ magnet });
    get().notify(magnet ? 'المغناطيس شغّال' : 'المغناطيس طافي', 'info');
  },
  copyLook(clipId) {
    const { project, selected } = get();
    const c = project?.clips.find((x) => x.id === (clipId ?? selected[0]));
    if (!c) return get().notify('حدّد لقطة أول');
    set({ look: lookOf(c) });
    get().notify('نُسخت الخصائص — حدّد لقطات والصقها (Ctrl+Alt+V)', 'info');
  },
  async pasteLook(ids) {
    const { project, look, selected } = get();
    if (!project) return;
    if (!look) return get().notify('انسخ خصائص لقطة أول (Ctrl+Alt+C)');
    const ops = pasteLookOps(project, look, ids ?? selected);
    if (!ops.length) return get().notify(look.kind === 'text' ? 'حدّد نصوص تلصق عليها الخصائص' : 'حدّد لقطات من نفس النوع تلصق عليها الخصائص');
    if (await get().ops(ops)) get().notify(ops.length === 1 ? 'لُصقت الخصائص' : `لُصقت الخصائص على ${ops.length} لقطات`, 'info');
  },
  copyClips() {
    const { project, selected } = get();
    const clips = project?.clips.filter((c) => selected.includes(c.id)) ?? [];
    if (!clips.length) return get().notify('حدّد لقطة أول');
    set({ clipboard: structuredClone(clips) });
    get().notify(clips.length === 1 ? 'نُسخت اللقطة — Ctrl+V يلصقها عند المؤشر' : `نُسخت ${clips.length} لقطات — Ctrl+V يلصقها عند المؤشر`, 'info');
  },
  async pasteClips() {
    const { project, clipboard, time } = get();
    if (!project) return;
    if (!clipboard?.length) return get().notify('انسخ لقطة أول (Ctrl+C)');
    const { ops, ids } = pasteOps(project, clipboard, time);
    if (ops.length && (await get().ops(ops))) set({ selected: ids });
  },
  async duplicateClips() {
    const { project, selected } = get();
    if (!project || !selected.length) return get().notify('حدّد لقطة أول');
    const { ops, ids } = duplicateOps(project, selected);
    if (ops.length && (await get().ops(ops))) set({ selected: ids });
  },
  async clipTool(clipId, tool, body = {}) {
    const { name } = get(), sequence = openSequence;
    if (!name) return;
    try {
      const r = await api.post<{ rev?: number; project?: Project; history?: State['history']; job?: Job; reversed?: boolean }>(`${projectPath(name)}/clips/${encodeURIComponent(clipId)}/${tool}`, body);
      if (sequence !== openSequence || get().name !== name) return;
      if (r.project && r.rev !== undefined && r.rev >= get().rev) set({ project: r.project, rev: r.rev, history: r.history! });
      if (r.job) get().notify('يجهّز النسخة المعكوسة… تتبدّل اللقطة أول ما تخلص', 'info');
      else if (tool === 'reverse') get().notify(r.reversed ? 'اللقطة تشتغل بالعكس' : 'رجعت اللقطة لاتجاهها الأصلي', 'info');
    } catch (e) { get().notify((e as Error).message); }
  },
  panel: 'assistant',
  panels: savedPanels(),
  mediaOverlay: false,
  showPanel(which, on) {
    const panels = { ...get().panels, [which]: on };
    set({ panels, mediaOverlay: which === 'media' ? on && !bothFit() : on ? false : get().mediaOverlay });
    try { localStorage.setItem('panels', JSON.stringify(panels)); } catch { /* private mode */ }
  },
  connection: 'connecting',
  stylesOpen: false,
  openStyle(id, source) { set({ stylesOpen: true, styleTarget: { id, source }, playing: false }); },
  setGraphicPick(graphicPick) {
    set({ graphicPick });
  },
  setStylesOpen(stylesOpen) {
    set({ stylesOpen, playing: false, styleTarget: undefined });
  },

  async loadProjects() {
    const sequence = ++projectsSequence;
    try { const [projects, folders] = await Promise.all([api.get<ProjectSummary[]>('/api/projects'), api.get<ProjectFolder[]>('/api/folders').catch(() => get().folders)]); if (sequence === projectsSequence) set({ projects, folders, projectsLoaded: true, projectsError: undefined }); }
    catch (e) { if (sequence === projectsSequence) set({ projectsError: (e as Error).message }); throw e; }
  },
  async loadTrash() {
    const sequence = ++trashSequence;
    const trash = await api.get<TrashedProject[]>('/api/projects/.trash');
    if (sequence === trashSequence) set({ trash });
  },

  async loadActiveJobs() {
    const jobs = await api.get<Job[]>('/api/jobs');
    set({ activeJobs: Object.fromEntries(jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => [j.id, j])) });
  },
  async renameProject(name, displayName) {
    await api.patch(projectPath(name), { name: displayName.trim() });
    ++projectsSequence;
    set((s) => ({ projects: s.projects.map((p) => p.name === name ? { ...p, displayName: displayName.trim() } : p) }));
    await get().loadProjects().catch(() => {});
  },
  async deleteProject(name) {
    const { trashed: removed } = await api.delete<{ ok: true; trashed: TrashedProject }>(projectPath(name));
    ++projectsSequence; ++trashSequence;
    if (get().name === name) get().close();
    set((s) => ({ projects: s.projects.filter((p) => p.name !== name), trash: [removed, ...s.trash.filter((p) => p.id !== removed.id)] }));
    return removed;
  },
  async restoreProject(id) {
    const restored = await api.post<{ name: string; project: Project }>(`/api/projects/.trash/${encodeURIComponent(id)}/restore`);
    ++projectsSequence; ++trashSequence;
    set((s) => ({ trash: s.trash.filter((p) => p.id !== id), projects: [{ name: restored.name, displayName: restored.project.name, modified: Date.now(), media: restored.project.media.length, duration: projectDuration(restored.project) }, ...s.projects.filter((p) => p.name !== restored.name)] }));
    await get().loadProjects().catch(() => {});
  },

  async loadCheckpoints() {
    const { name } = get(), sequence = openSequence, request = ++checkpointsSequence;
    if (!name) return;
    const checkpoints = await api.get<Checkpoint[]>(`${projectPath(name)}/checkpoints`);
    if (sequence === openSequence && request === checkpointsSequence && get().name === name) set({ checkpoints });
  },
  async saveCheckpoint(label) {
    const { name } = get(), sequence = openSequence;
    if (!name) throw new Error('افتح مشروعًا لحفظ نقطة.');
    const { checkpoint } = await api.post<{ checkpoint: Checkpoint }>(`${projectPath(name)}/checkpoints`, { label: label.trim() });
    if (sequence === openSequence && get().name === name) {
      ++checkpointsSequence;
      set((s) => ({ checkpoints: [checkpoint, ...s.checkpoints.filter((p) => p.id !== checkpoint.id)] }));
    }
    return checkpoint;
  },
  async restoreCheckpoint(id, expectedRev) {
    const { name } = get(), sequence = openSequence;
    if (!name) throw new Error('افتح مشروعًا لاستعادة نقطة حفظ.');
    const r = await api.post<{ project: Project; rev: number; history: State['history']; safetyCheckpoint: Checkpoint }>(`${projectPath(name)}/checkpoints/${encodeURIComponent(id)}/restore`, { expectedRev });
    if (get().name === name) {
      ++checkpointsSequence;
      set((s) => ({ checkpoints: [r.safetyCheckpoint, ...s.checkpoints.filter((p) => p.id !== r.safetyCheckpoint.id)] }));
    }
    if (sequence === openSequence && get().name === name) {
      ++openSequence; ++checkpointsSequence;
      const latest = get();
      const project = latest.rev > r.rev ? latest.project! : r.project;
      set({ project, rev: Math.max(latest.rev, r.rev), history: latest.rev > r.rev ? latest.history : r.history, playing: false, time: 0, selected: [], draftBase: undefined, noteDraft: undefined, focusNote: undefined, graphicPick: undefined, transcripts: {}, analysis: {} });
      for (const media of project.media) get().loadMediaData(media.id);
    }
    return r.safetyCheckpoint;
  },
  async startRender(quality, expectedRev, settings) {
    const { name, rev } = get(), sequence = openSequence;
    if (!name) throw new Error('افتح مشروعًا لتصديره.');
    if (rev !== expectedRev) throw new Error('تغيّر المشروع بعد فحص الجاهزية. أعد الفحص قبل التصدير.');
    const r = await api.post<{ job: Job; render: RenderVersion }>(`${projectPath(name)}/render`, { quality, expectedRev, export: settings });
    if (sequence === openSequence && get().name === name) set((s) => {
      const job = s.jobs[r.job.id] ?? r.job;
      return { jobs: { ...s.jobs, [r.job.id]: { ...job, render: job.render ?? r.render } } };
    });
    return r.render;
  },

  async open(name) {
    const sequence = ++openSequence;
    let r;
    try { r = await api.get(projectPath(name)); }
    catch (e) { if (sequence === openSequence) get().notify((e as Error).message); return; }
    if (sequence !== openSequence) return;
    const url = new URL(location.href);
    url.searchParams.set('p', name);
    history.replaceState(null, '', url);
    set({ name, mediaOverlay: false, project: r.project, rev: r.rev, history: r.history, transcripts: {}, analysis: {}, checkpoints: [], time: 0, playing: false, selected: [], jobs: {}, lastRender: undefined, draftBase: undefined, noteDraft: undefined, focusNote: undefined, graphicPick: undefined, stylesOpen: false, playRange: undefined, rangeDeletePrompt: false });
    const jobs = await api.get<Job[]>(`/api/jobs?project=${encodeURIComponent(name)}`).catch(() => []);
    if (sequence !== openSequence) return;
    set((s) => ({ jobs: { ...Object.fromEntries(jobs.map((j) => [j.id, j])), ...s.jobs } }));
    for (const m of r.project.media) get().loadMediaData(m.id);
    // fit the edit into the timeline width
    const dur = Math.max(10, projectDuration(r.project));
    set({ zoom: Math.max(2, Math.min(120, (window.innerWidth - 140) / dur)) });
  },

  close() {
    ++openSequence;
    const url = new URL(location.href);
    url.searchParams.delete('p');
    history.replaceState(null, '', url);
    set({ name: undefined, mediaOverlay: false, project: undefined, playing: false, selected: [], jobs: {}, lastRender: undefined, draftBase: undefined, noteDraft: undefined, focusNote: undefined, graphicPick: undefined, transcripts: {}, analysis: {}, checkpoints: [], stylesOpen: false, playRange: undefined, rangeDeletePrompt: false });
  },

  async create(name, displayName, start = 'video', folder) {
    await api.post('/api/projects', { name, start });
    if (displayName) await api.patch(projectPath(name), { name: displayName });
    if (folder) await addToFolder(folder, [name]).catch(() => {});
    await get().loadProjects();
    await get().open(name);
  },

  async ops(ops) {
    const { name, project, transcripts } = get();
    const sequence = openSequence;
    if (!name || !project) return false;
    let optimistic: Project;
    // apply locally first so drags and cuts feel instant; the server's answer replaces it
    try {
      optimistic = applyOps(project, ops, { words: (m) => transcripts[m]?.words });
      set({ project: optimistic });
    } catch (e) {
      get().notify((e as Error).message);
      return false;
    }
    try {
      const r = await api.post(`${projectPath(name)}/ops`, { ops, author: 'user' });
      useStartGuide.getState().record(project, ops);
      if (sequence === openSequence && name === get().name && r.rev >= get().rev) set({ project: r.project, rev: r.rev, history: r.history });
      return true;
    } catch (e) {
      if (sequence === openSequence && get().name === name) {
        if (get().project === optimistic) set({ project });
        // A failed request must not roll back a newer edit delivered by WebSocket.
        try {
          const r = await api.get(projectPath(name));
          if (sequence === openSequence && r.rev >= get().rev) set({ project: r.project, rev: r.rev, history: r.history });
        } catch { /* reconnect will retrieve authoritative state */ }
      }
      get().notify((e as Error).message);
      return false;
    }
  },

  async addTitle() {
    const { project, time, name } = get();
    if (!project) return;
    const plan = titlePlan(project, time);
    set({ playing: false });
    if (await get().ops(plan.ops) && get().name === name && get().project?.clips.some((c) => c.id === plan.id)) {
      set({ selected: [plan.id], editText: plan.id });
      get().setPanel('inspect');
    }
  },

  preview(ops) {
    const { project, draftBase, transcripts } = get();
    const base = draftBase ?? project;
    if (!base) return;
    try {
      set({ draftBase: base, project: applyOps(base, ops, { words: (m) => transcripts[m]?.words }) });
    } catch {
      /* invalid mid-drag value: keep the last good preview */
    }
  },

  async commit(ops) {
    const { draftBase } = get();
    if (draftBase) set({ project: draftBase, draftBase: undefined });
    return get().ops(ops);
  },

  async undo() {
    const { name } = get();
    const sequence = openSequence;
    if (!name) return;
    try {
      const r = await api.post(`${projectPath(name)}/undo`);
      if (sequence === openSequence && r.rev >= get().rev) set({ project: r.project, rev: r.rev, history: r.history });
    } catch (e) { get().notify((e as Error).message); }
  },
  async redo() {
    const { name } = get();
    const sequence = openSequence;
    if (!name) return;
    try {
      const r = await api.post(`${projectPath(name)}/redo`);
      if (sequence === openSequence && r.rev >= get().rev) set({ project: r.project, rev: r.rev, history: r.history });
    } catch (e) { get().notify((e as Error).message); }
  },

  setPanel(panel) {
    set({ panel });
    get().showPanel('tools', true);
  },
  startNote(at, end) {
    set({ noteDraft: { at: at ?? get().time, end }, panel: 'notes', playing: false });
    get().showPanel('tools', true);
  },
  setNoteDraft(noteDraft) {
    set({ noteDraft });
  },
  showNote(id) {
    const n = get().project?.notes.find((x) => x.id === id);
    if (n) {
      set({ focusNote: id, panel: 'notes', time: n.at });
      get().showPanel('tools', true);
    }
  },
  seek(t) {
    const p = get().project;
    const max = p ? projectDuration(p) : 0;
    set({ time: Math.max(0, Math.min(max, t)), playRange: undefined });
  },
  setPlaying(playing) {
    if (playing) resumeAudio(); // inside the click / key press that started playback
    const p = get().project;
    if (playing && p && get().time >= projectDuration(p) - 0.05) set({ time: 0 });
    set({ playing, playRange: undefined });
  },
  select(selected) {
    set({ selected });
  },
  setZoom(zoom) {
    set({ zoom: Math.max(1, Math.min(400, zoom)) });
  },
  notify(text, kind = 'error') {
    set({ toast: { text, kind, at: Date.now() } });
  },

  async loadMediaData(mediaId) {
    const { name, project } = get();
    const sequence = openSequence;
    const m = project?.media.find((x) => x.id === mediaId);
    if (!name || !m) return;
    const base = `${projectPath(name)}/analysis/${mediaId}`;
    // only what analysis has produced (a silent clip has no peaks): no 404s in the console
    const grab = <T,>(step: string) => ((step === 'peaks' && m.hasAudio || m.analyzed.includes(step)) ? api.get<T>(`${base}/${step}.json`).catch(() => undefined) : Promise.resolve(undefined));
    const [peaks, thumbs, shots] = await Promise.all([grab<Peaks>('peaks'), grab<Thumbs>('thumbs'), grab<Shot[]>('shots')]);
    if (sequence !== openSequence) return;
    set((s) => ({ analysis: { ...s.analysis, [mediaId]: { peaks, thumbs, shots } } }));
    if (m.analyzed.includes('transcribe')) {
      const t = await api.get<Transcript>(`${projectPath(name)}/media/${mediaId}/transcript`).catch(() => null);
      if (sequence !== openSequence) return;
      set((s) => ({ transcripts: { ...s.transcripts, [mediaId]: t } }));
    }
  },
}));

/** Live updates from the server: edits by Claude, job progress, analysis results. */
export function connectLive() {
  let ws: WebSocket | undefined;
  let retry = 500;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (disposed) return;
    useStore.setState({ connection: 'connecting' });
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      if (disposed) return;
      useStore.setState({ connection: 'connected' });
      retry = 500;
      // the server may have started after the page, or restarted: (re)load what we show
      const s = useStore.getState();
      s.loadProjects().catch(() => {});
      useFavorites.getState().load();
      const wanted = new URL(location.href).searchParams.get('p');
      if (wanted && wanted === s.name && s.project) {
        // reconnect: refresh the data, keep the playhead and selection
        // A new socket may belong to a restarted server whose revisions begin at
        // zero. Invalidate old in-flight replies and start a fresh revision epoch.
        const sequence = ++openSequence;
        useStore.setState({ rev: -1 });
        api.get(projectPath(wanted)).then((r) => {
          const current = useStore.getState();
          if (!disposed && sequence === openSequence && current.name === wanted && r.rev >= current.rev) {
            useStore.setState({ project: r.project, rev: r.rev, history: r.history, draftBase: undefined });
            for (const m of r.project.media) current.loadMediaData(m.id);
          }
        }).catch(() => {});
        const jobsBefore = useStore.getState().jobs;
        api.get<Job[]>(`/api/jobs?project=${encodeURIComponent(wanted)}`).then((jobs) => {
          const current = useStore.getState();
          if (disposed || sequence !== openSequence || current.name !== wanted) return;
          const refreshed = Object.fromEntries(jobs.map((j) => [j.id, j]));
          // Preserve job events received while the refresh request was in flight.
          for (const [id, job] of Object.entries(current.jobs)) if (job !== jobsBefore[id]) refreshed[id] = job;
          useStore.setState({ jobs: refreshed });
        }).catch(() => {});
      } else if (wanted) s.open(wanted).catch(() => {});
    };
    ws.onmessage = (ev) => {
      if (disposed) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      const s = useStore.getState();
      // The home library stays live for external imports, edits and analysis,
      // including projects that are not open in this browser.
      if (msg.type === 'project' && msg.project && (msg.name !== s.name || msg.rev >= s.rev)) {
        ++projectsSequence;
        const row: ProjectSummary = { name: msg.name, displayName: msg.project.name, modified: Date.now(), media: msg.project.media.length, duration: projectDuration(msg.project) };
        useStore.setState({ projects: s.projects.some((p) => p.name === msg.name) ? s.projects.map((p) => p.name === msg.name ? row : p) : [...s.projects, row] });
        if (!s.projectsLoaded) s.loadProjects().catch(() => {});
      }
      if (msg.type === 'project' && msg.name === s.name && msg.rev >= s.rev && (!s.draftBase || msg.author === 'checkpoint')) {
        const before = s.project;
        const restored = msg.author === 'checkpoint';
        if (restored) ++openSequence;
        useStore.setState({ project: msg.project, rev: msg.rev, history: msg.history, ...(restored ? { playing: false, time: 0, selected: [], draftBase: undefined, noteDraft: undefined, focusNote: undefined, graphicPick: undefined, transcripts: {}, analysis: {} } : {}) });
        if (restored) s.loadCheckpoints().catch(() => {});
        // the first clip just landed on an empty timeline: show all of it
        if (before && !before.clips.length && msg.project.clips.length) {
          useStore.setState({ zoom: Math.max(2, Math.min(120, (window.innerWidth - 140) / Math.max(10, projectDuration(msg.project)))) });
        }
        // analysis finished for some media: fetch its data
        for (const m of msg.project.media as Project['media']) {
          const old = before?.media.find((x) => x.id === m.id);
          if (restored || !old || old.analyzed.length !== m.analyzed.length) s.loadMediaData(m.id);
        }
        if (msg.author === 'claude') s.notify('Claude عدّل المشروع', 'info');
      } else if (msg.type === 'analysis' && msg.name === s.name) {
        s.loadMediaData(msg.mediaId);
      } else if (msg.type === 'projects') {
        s.loadProjects().catch(() => {});
        s.loadTrash().catch(() => {});
      } else if (msg.type === 'project_deleted') {
        ++projectsSequence;
        useStore.setState({ projects: s.projects.filter((p) => p.name !== msg.name) });
        if (msg.name === s.name) { s.close(); s.notify('نُقل هذا المشروع إلى المحذوفات. يمكنك استعادته من صفحة المشاريع.', 'info'); }
        s.loadProjects().catch(() => {});
      } else if (msg.type === 'job') {
        const job: Job = msg.job;
        const { [job.id]: _, ...others } = s.activeJobs;
        useStore.setState({ activeJobs: job.status === 'queued' || job.status === 'running' ? { ...others, [job.id]: job } : others });
        if (job.project !== s.name) return;
        useStore.setState({ jobs: { ...s.jobs, [job.id]: job } });
        if (job.status === 'error') s.notify(`${job.label}: ${job.error}`);
        if (job.status === 'done' && job.kind === 'render') useStore.setState({ lastRender: { url: job.result.url, output: job.result.output, rev: job.result.rev ?? job.render?.rev, snapshotId: job.result.snapshotId ?? job.render?.snapshotId, quality: job.result.quality ?? job.render?.quality } });
      } else if (msg.type === 'warning') {
        s.notify(msg.message);
      } else if (msg.type === 'favorites' && Array.isArray(msg.ids)) {
        useFavorites.setState({ ids: msg.ids });
      }
    };
    ws.onclose = () => {
      if (disposed) return;
      useStore.setState({ connection: 'disconnected' });
      timer = setTimeout(connect, retry);
      retry = Math.min(5000, retry * 2);
    };
  };
  connect();
  return () => { disposed = true; clearTimeout(timer); ws?.close(); };
}

// handy for debugging from the browser console in dev
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;

/**
 * The playhead for panels (inspector, comments, transport clock): exact while paused or scrubbing, about 8 times a
 * second while playing. The preview and the timeline's playhead stay per frame; panels re-rendering on every frame made
 * the timeline stutter while playing.
 */
export function useSlowTime(): number {
  const [time, setTime] = useState(() => useStore.getState().time);
  useEffect(() => {
    let last = 0;
    setTime(useStore.getState().time);
    return useStore.subscribe((s, p) => {
      if (s.time === p.time && s.playing === p.playing) return;
      const now = performance.now();
      if (s.playing && p.playing && now - last < 125) return;
      last = now;
      setTime(s.time);
    });
  }, []);
  return time;
}

/** Puts projects into a home-page folder (a project is in one folder at most: the server takes it out of any other). */
export async function addToFolder(id: string, names: string[]) {
  const f = useStore.getState().folders.find((x) => x.id === id) ?? (await api.get<ProjectFolder[]>('/api/folders')).find((x) => x.id === id);
  if (!f) throw new Error('المجلد غير موجود');
  await api.patch(`/api/folders/${id}`, { projects: [...new Set([...f.projects, ...names])] });
  await useStore.getState().loadProjects().catch(() => {});
}
/** Takes projects out of their folders (back to the top of the library). */
export async function removeFromFolders(names: string[]) {
  for (const f of useStore.getState().folders.filter((x) => x.projects.some((p) => names.includes(p))))
    await api.patch(`/api/folders/${f.id}`, { projects: f.projects.filter((p) => !names.includes(p)) });
  await useStore.getState().loadProjects().catch(() => {});
}
