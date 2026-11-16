import { describe, it, expect } from 'vitest';
import { exportFileName, parseSavedExport, quickExportChoice } from '../src/lib/export-preferences.ts';

describe('remembered exports', () => {
  it('opens the dialog for first use and invalid preferences', () => {
    expect(quickExportChoice('demo')).toBeUndefined();
    for (const raw of ['bad', '{}', '{"quality":"bad","preset":"review","settings":{}}']) expect(parseSavedExport(raw)).toBeUndefined();
  });
  it('keeps preset quality and suffix, and ignores a stale marked range', () => {
    const saved = parseSavedExport(JSON.stringify({ preset: 'review', quality: 'preview', settings: { level: 'small', range: [1, 3] } }));
    const choice = quickExportChoice('فيديو', saved)!;
    expect(choice.quality).toBe('preview'); expect(choice.settings.level).toBe('small');
    expect(choice.settings.fileName).toBe('فيديو - مراجعة'); expect(choice.settings.range).toBeUndefined();
  });
  it('remembers a typed project name and derives untyped names after renaming', () => {
    const saved = { preset: 'review', quality: 'preview' as const, settings: { fileName: 'اسم خاص' }, nameTouched: true };
    expect(exportFileName('المشروع', saved)).toBe('اسم خاص');
    expect(exportFileName('الجديد', { ...saved, nameTouched: false })).toBe('الجديد - مراجعة');
  });
});
