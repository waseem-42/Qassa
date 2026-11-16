import { create } from 'zustand';
import { markedRange } from '@edit/shared';
import { api, projectPath } from './api.ts';
import { canSubmitExport, type ExportPreflight } from './export.ts';
import { loadSavedExport, quickExportChoice } from './export-preferences.ts';
import { useHeaderDialog } from './palette.ts';
import { useStore, type Job } from './store.ts';

export const useQuickExport = create<{
  checking: boolean; notice?: { project: string; job: Job; warnings: number };
  warnings: Record<string, number>; dismiss(): void;
}>((set) => ({ checking: false, warnings: {}, dismiss: () => set({ notice: undefined }) }));
export async function quickExport(marked = false) {
  const s = useStore.getState(), { name, project } = s;
  if (!name || !project || useQuickExport.getState().checking) return;
  const choice = quickExportChoice(project.name, loadSavedExport(name));
  if (!choice) return useHeaderDialog.getState().setDialog('export');
  if (s.draftBase || s.connection !== 'connected') return s.notify('أكمل التعديل واتصل بالخادم قبل التصدير.');
  useQuickExport.setState({ checking: true, notice: undefined });
  try {
    const aspect = choice.settings.aspect ?? project.settings.aspect;
    const check = await api.get<ExportPreflight>(`${projectPath(name)}/render/preflight?quality=${choice.quality}&aspect=${aspect}`);
    if (useStore.getState().name !== name) return;
    if (!canSubmitExport(check, useStore.getState().rev, choice.quality)) {
      useHeaderDialog.getState().setDialog('export');
      if (check.rev !== useStore.getState().rev) s.notify('تغيّر المشروع منذ الفحص؛ راجع الجاهزية مجددًا.');
      return;
    }
    const range = marked ? markedRange(useStore.getState().project!) : undefined;
    if (marked && !range) return s.notify('حدّد بداية ونهاية جزء التصدير أولًا.');
    useQuickExport.setState((q) => ({ warnings: { ...q.warnings, [check.snapshotId]: check.warnings.length + (check.review?.length ?? 0) } }));
    await useStore.getState().startRender(choice.quality, check.rev, { ...choice.settings, ...(range ? { range } : {}) }, marked);
  } catch (e) {
    if (useStore.getState().name === name) { useHeaderDialog.getState().setDialog('export'); s.notify((e as Error).message); }
  } finally { useQuickExport.setState({ checking: false }); }
}
