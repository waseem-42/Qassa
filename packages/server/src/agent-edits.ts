import { AsyncLocalStorage } from 'node:async_hooks';
import type { Op, Project } from '@edit/shared';
import { ProjectManagementError } from './project-paths.ts';
import type { Store, ChangeEvent } from './store.ts';

export interface AgentChange { label: string; count: number; at: number; clipIds: string[] }
interface Boundary { name: string; before: Project; active: boolean; rev: number; blocked?: string; undone?: boolean; changes: Map<string, AgentChange> }
const LABELS = { cut: 'قص وتقصير', add: 'لقطات ونصوص جديدة', move: 'نقل وتوقيت', text: 'تغيير النصوص', sound: 'تغيير الصوت', picture: 'تغيير الصورة', other: 'إعدادات وتعديلات أخرى' };

/** Restore only while every intervening write belongs to this task. */
export class AgentEdits {
  private scope = new AsyncLocalStorage<string>();
  private tasks = new Map<string, Boundary>();

  constructor(private store: Store) {
    store.on('change', (e: ChangeEvent) => {
      for (const [id, task] of this.tasks) if (task.name === e.name && !task.undone) {
        if (task.active && id === this.scope.getStore()) task.rev = e.rev;
        else task.blocked = 'تغيّر المشروع خارج هذه المهمة؛ التراجع الكامل قد يمس تعديلاتك. استخدم التراجع العادي أو نقطة حفظ.';
      }
    });
    store.on('ops', (e: { name: string; ops: Op[]; before: Project; project: Project }) => {
      const task = this.tasks.get(this.scope.getStore() ?? '');
      if (!task?.active || task.name !== e.name) return;
      for (const op of e.ops) {
        const kind = /^(split|trim|cut_|delete)/.test(op.op) ? 'cut'
          : /^(add_clip|add_text|duplicate)/.test(op.op) ? 'add'
          : /^(move|reorder|set_timing)/.test(op.op) ? 'move'
          : op.op === 'update_clip' ? ('text' in op.patch || 'textStyle' in op.patch ? 'text'
            : ['volume', 'fadeIn', 'fadeOut', 'denoise'].some((k) => k in op.patch) ? 'sound' : 'picture') : 'other';
        const ids = ('clipId' in op ? [op.clipId] : 'clipIds' in op ? op.clipIds : 'mediaId' in op ? e.before.clips.filter((c) => c.mediaId === op.mediaId && (op.op !== 'cut_range' || c.out > op.t0 && c.in < op.t1)).map((c) => c.id) : e.project.clips.filter((c) => !e.before.clips.some((b) => b.id === c.id)).map((c) => c.id)) ?? [];
        const clips = ids.map((id) => e.project.clips.find((c) => c.id === id) ?? e.before.clips.find((c) => c.id === id)).filter((c) => !!c);
        const at = op.op === 'split' ? op.at : Math.min(...clips.map((c) => c.start + (op.op === 'cut_range' ? Math.max(0, op.t0 - c.in) / c.speed : 0)), Infinity), old = task.changes.get(kind);
        task.changes.set(kind, { label: LABELS[kind], count: (old?.count ?? 0) + 1, at: Math.min(old?.at ?? Infinity, Number.isFinite(at) ? at : 0), clipIds: [...new Set([...(old?.clipIds ?? []), ...ids])].slice(0, 32) });
      }
    });
  }

  begin(name: string, id: string) {
    const e = this.store.get(name);
    this.tasks.set(id, { name, before: structuredClone(e.project), rev: e.rev, active: true, changes: new Map() });
    for (const [key, task] of this.tasks) { if (this.tasks.size <= 20) break; if (!task.active) this.tasks.delete(key); }
  }

  run<T>(id: string | undefined, fn: () => T): T { return this.scope.run(id && this.tasks.get(id)?.active ? id : '', fn); }

  finish(name: string, id: string) {
    const task = this.tasks.get(id);
    if (task?.name === name) task.active = false;
    return this.status(name, id);
  }

  status(name: string, id: string) {
    const task = this.tasks.get(id), valid = task?.name === name ? task : undefined;
    const reason = !valid ? 'حدود هذه المهمة غير متاحة بعد إعادة تشغيل الخادم أو انتهاء سجل الجلسة.'
      : valid.active ? 'المهمة ما زالت تعمل.' : valid.undone ? 'تم التراجع عن هذه المهمة.'
      : valid.blocked ?? (valid.changes.size ? undefined : 'لم تسجّل المهمة تعديلات بالأدوات.');
    return { available: !reason, reason, undone: !!valid?.undone, changes: valid ? [...valid.changes.values()].sort((a, b) => a.at - b.at) : [] };
  }

  undo(name: string, id: string) {
    const state = this.status(name, id);
    if (!state.available) throw new ProjectManagementError(state.reason!, 409);
    const task = this.tasks.get(id)!;
    const result = this.store.restoreProject(name, task.before, task.rev);
    task.undone = true;
    return { ...result, ...this.status(name, id), history: this.store.history(name) };
  }
}
