import { ExportSettings } from '@edit/shared';
import type { ExportQuality } from './export.ts';

export interface SavedExport { preset: string; quality: ExportQuality; settings: Partial<ExportSettings>; nameTouched?: boolean }
export const exportKey = (name: string) => `qassa.export.${name}`;
export const NAME_SUFFIX: Record<string, string> = { youtube: 'يوتيوب', shorts: 'شورتس', instagram: 'إنستقرام', '4k': '4K', review: 'مراجعة', audio: 'صوت' };
export function parseSavedExport(raw: string | null): SavedExport | undefined {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || !['preview', 'final'].includes(v.quality) || typeof v.preset !== 'string') return;
    const settings = ExportSettings.partial().safeParse(v.settings);
    if (settings.success) return { preset: v.preset, quality: v.quality, settings: settings.data, nameTouched: v.nameTouched === true };
  } catch { /* invalid viewer preferences use the first-export path */ }
}
export function loadSavedExport(name: string): SavedExport | undefined {
  try { return parseSavedExport(localStorage.getItem(exportKey(name))); } catch { return; }
}
export function exportFileName(name: string, saved?: SavedExport): string {
  return saved?.nameTouched && saved.settings.fileName?.trim() || `${name}${NAME_SUFFIX[saved?.preset ?? ''] ? ` - ${NAME_SUFFIX[saved!.preset]}` : ''}`;
}
export function quickExportChoice(name: string, saved?: SavedExport) {
  if (!saved) return;
  const { range: _, ...settings } = saved.settings;
  return { quality: saved.quality, settings: ExportSettings.parse({ ...settings, fileName: exportFileName(name, saved) }) };
}
