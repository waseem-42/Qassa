import { describe, expect, it } from 'vitest';
import { canSubmitExport, parseTimecode, type ExportPreflight } from '../src/lib/export.ts';

const check: ExportPreflight = { ready: true, rev: 3, quality: 'final', snapshotId: 'captured-edit', blockers: [], warnings: [], resources: [] };
describe('export readiness guard', () => {
  it('accepts a ready checked revision even with review warnings', () => {
    expect(canSubmitExport({ ...check, warnings: [{ code: 'open_notes', message: 'Review notes' }] }, 3, 'final')).toBe(true);
  });
  it('requires a completed check for the same revision and quality', () => {
    expect(canSubmitExport(undefined, 3, 'final')).toBe(false);
    expect(canSubmitExport(check, 4, 'final')).toBe(false);
    expect(canSubmitExport(check, 3, 'preview')).toBe(false);
  });
  it('blocks missing dependencies even if an inconsistent payload says ready', () => {
    expect(canSubmitExport({ ...check, blockers: [{ code: 'missing_media', message: 'Missing media' }] }, 3, 'final')).toBe(false);
    expect(canSubmitExport({ ...check, ready: false }, 3, 'final')).toBe(false);
  });
});

describe('timecode entry', () => {
  it('reads seconds, m:ss and h:mm:ss, with Arabic digits and a comma', () => {
    expect(parseTimecode('83.5')).toBe(83.5);
    expect(parseTimecode('01:23.5')).toBe(83.5);
    expect(parseTimecode('1:02:03')).toBe(3723);
    expect(parseTimecode('٠١:٢٠,٥')).toBe(80.5);
  });
  it('refuses what is not a time', () => {
    for (const t of ['', 'abc', '1:75', '1::2', '-3']) expect(parseTimecode(t)).toBeUndefined();
  });
});
