import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project, STYLE_PRESETS } from '@edit/shared';

const workspace = vi.hoisted(() => ({ root: '' }));
vi.mock('../src/config.ts', () => ({ get DATA_DIR() { return workspace.root; } }));
workspace.root = mkdtempSync(join(tmpdir(), 'edit-styles-test-'));
const { saveStyle, resolveStyle, deleteStyle, STYLES_DIR } = await import('../src/styles.ts');
const project = () => Project.parse({ name: 'style-test', createdAt: '2026-01-01', settings: { captionStyle: { size: 54, animation: 'pop', x: 0.4, align: 'center', preset: 'caption' } } });
beforeEach(() => rmSync(STYLES_DIR, { recursive: true, force: true }));
afterAll(() => rmSync(workspace.root, { recursive: true, force: true }));

describe('saved styles', () => {
  it('saving does not mutate project captions or retain mutable project references', () => {
    const p = project(), before = structuredClone(p);
    const saved = saveStyle(p, workspace.root, 'قناتي');
    expect(p).toEqual(before);
    expect(saved.captions?.animation).toBeUndefined();
    saved.theme.accent = '#123456';
    expect(p.settings.theme).toEqual(before.settings.theme);
  });
  it('long repeated names remain resolvable and deletable', () => {
    const p = project(), name = 'a'.repeat(80);
    const first = saveStyle(p, workspace.root, name);
    const second = saveStyle(p, workspace.root, name);
    expect(second.id).not.toBe(first.id);
    expect(resolveStyle(second.id, workspace.root)?.style.id).toBe(second.id);
    expect(deleteStyle(second.id)).toBe(true);
    expect(deleteStyle(first.id)).toBe(true);
    expect(deleteStyle('../styles')).toBe(false);
  });
  it('a saved name cannot shadow a built-in preset identifier', () => {
    const preset = STYLE_PRESETS[0];
    const saved = saveStyle(project(), workspace.root, preset.id);
    expect(saved.id).not.toBe(preset.id);
    expect(resolveStyle(saved.id, workspace.root)?.style.name).toBe(preset.id);
    expect(resolveStyle(preset.id, workspace.root)?.style.name).toBe(preset.name);
  });
  it('handles Windows reserved names and names truncated at a word separator', () => {
    for (const name of ['CON', 'nul', `${'a'.repeat(39)} rest`]) {
      const saved = saveStyle(project(), workspace.root, name);
      expect(resolveStyle(saved.id, workspace.root)?.style.name).toBe(name);
      expect(deleteStyle(saved.id)).toBe(true);
    }
  });
});
