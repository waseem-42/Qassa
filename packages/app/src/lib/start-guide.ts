import { create } from 'zustand';
import type { Op, Project } from '@edit/shared';

const KEY = 'qassa.start-guide';
interface Progress { dismissed: boolean; edited: string[] }
function load(): Progress {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { dismissed: value.dismissed === true, edited: Array.isArray(value.edited) ? value.edited.filter((v: unknown) => typeof v === 'string').slice(-100) : [] };
  } catch { return { dismissed: false, edited: [] }; }
}
function save(progress: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* this viewer session still works */ }
}

export const guideProjectKey = (project: Project) => project.createdAt || project.name;
export function guideEdit(ops: Op[]): boolean {
  return ops.some((o) => o.op === 'add_clip' ? o.clip.text !== undefined || !!o.clip.graphic
    : o.op === 'resolve_suggestions' || o.op === 'resolve_ideas' ? o.accept
    : ['add_text', 'split', 'trim', 'delete', 'delete_range', 'cut_range', 'cut_words', 'keep_only', 'restore_range', 'speed_range', 'update_clip', 'move', 'move_main', 'reorder', 'set_timing', 'set_grade', 'detach_audio'].includes(o.op));
}
export function guideProgress(project: Project, edited: boolean, exported: boolean): boolean[] {
  return [!!project.media.length, !!project.clips.length, edited || project.clips.some((c) => c.text !== undefined || !!c.graphic), exported];
}
export function guideExported(project: Project, jobs: { kind: string; status: string; createdAt: number }[]): boolean {
  const createdAt = Date.parse(project.createdAt) || 0;
  return jobs.some((j) => j.kind === 'render' && j.status === 'done' && j.createdAt >= createdAt);
}

export const useStartGuide = create<Progress & { close(): void; show(): void; record(project: Project, ops: Op[]): void }>((set, get) => ({
  ...load(),
  close() { set({ dismissed: true }); save(get()); },
  show() { set({ dismissed: false }); save(get()); },
  record(project, ops) {
    const key = guideProjectKey(project);
    if (!guideEdit(ops) || get().edited.includes(key)) return;
    set({ edited: [...get().edited, key].slice(-100) }); save(get());
  },
}));
