import { expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Project, STYLE_PRESETS } from '@edit/shared';

it('keeps writable kits/styles/favourites separate from the read-only installed resources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qassa-data-')), data = join(root, 'data'), resources = join(root, 'resources');
  mkdirSync(join(resources, 'style-library'), { recursive: true }); writeFileSync(join(resources, 'style-library/catalog.json'), JSON.stringify({ sources: [], entries: [] }));
  vi.stubEnv('EDIT_DATA_DIR', data); vi.stubEnv('EDIT_RESOURCES_DIR', resources); vi.resetModules();
  try {
    const config = await import('../src/config.ts');
    expect(config.PROJECTS_DIR).toBe(join(data, 'projects')); expect(config.GRAPHICS_LIB_DIR).toBe(join(resources, 'graphics-lib'));
    const { brands } = await import('../src/brands.ts');
    const kit = brands.upload('kit.css', Buffer.from(':root { --accent:#123456; --text:#ffffff; }'));
    expect(brands.read(kit.id).theme.accent).toBe('#123456');
    const { saveStyle, STYLES_DIR } = await import('../src/styles.ts');
    saveStyle(Project.parse({ name: 'qa', createdAt: '' }), data, 'Test'); expect(STYLES_DIR).toBe(join(data, 'styles'));
    const { setFavorite, FAVORITES_FILE } = await import('../src/favorites.ts');
    setFavorite(STYLE_PRESETS[0].id, true); expect(FAVORITES_FILE).toBe(join(data, 'styles/favorites.json'));
    expect(readdirSync(root)).toEqual(['data', 'resources']); expect(readdirSync(resources)).toEqual(['style-library']); expect(readdirSync(join(resources, 'style-library'))).toEqual(['catalog.json']);
  } finally { vi.unstubAllEnvs(); vi.resetModules(); rmSync(root, { recursive: true, force: true }); }
});
