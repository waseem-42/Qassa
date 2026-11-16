import { describe, expect, it } from 'vitest';
import { searchStyleCatalog, styleCatalog } from '../src/style-library.ts';

describe('source style library', () => {
  it('records six pinned sources, unique entries, attribution and actual Lemo prompts', () => {
    const c = styleCatalog();
    expect(c.sources).toHaveLength(6);
    expect(c.sources.every((s) => /^[a-f0-9]{40}$/.test(s.revision))).toBe(true);
    expect(new Set(c.entries.map((e) => e.id)).size).toBe(c.entries.length);
    expect(c.entries.filter((e) => e.source === 'lemo')).toHaveLength(59);
    expect(c.entries.find((e) => e.id === 'lemo:archive-lighttable')?.prompt).toContain('Style');
    expect(c.sources.find((s) => s.id === 'onetake')?.license).toContain('Noncommercial');
  });
  it('filters and paginates without returning full prompts in the list', () => {
    const result = searchStyleCatalog('camera', 'hyperframes');
    expect(result.total).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.source === 'hyperframes' && !('prompt' in e))).toBe(true);
    expect(searchStyleCatalog('', '', 30).entries[0].id).not.toBe(searchStyleCatalog().entries[0].id);
    expect(searchStyleCatalog('this-does-not-exist-123').total).toBe(0);
  });
  it('combines source, category and query before paginating and reports source facets', () => {
    const result = searchStyleCatalog('camera', 'hyperframes', 0, 2, 'hyperframes:block');
    const expected = styleCatalog().entries.filter((e) => e.source === 'hyperframes' && e.category === 'hyperframes:block' && `${e.title} ${e.description} ${e.category} ${e.tags.join(' ')}`.toLowerCase().includes('camera'));
    expect(result.total).toBe(expected.length);
    expect(result.entries.map((e) => e.id)).toEqual(expected.slice(0, 2).map((e) => e.id));
    expect(result.categories).toEqual(['hyperframes:block', 'hyperframes:component']);
    expect(result.sources.reduce((sum, source) => sum + source.count, 0)).toBe(styleCatalog().entries.length);
    expect(searchStyleCatalog('', 'lemo', 0, 30, 'hyperframes:block').total).toBe(0);
  });
  it('links a preview picture for the gallery and can list those first or alone', () => {
    const c = styleCatalog();
    expect(c.entries.filter((e) => e.source === 'lemo').every((e) => e.thumb?.startsWith('https://raw.githubusercontent.com/'))).toBe(true);
    expect(c.entries.filter((e) => e.source === 'awesome').every((e) => e.thumb)).toBe(true);
    const all = searchStyleCatalog('', 'hyperframes', 0, 60, '', { previewFirst: true });
    const firstBare = all.entries.findIndex((e) => !e.thumb);
    expect(all.withPreview).toBeGreaterThan(0);
    expect(firstBare).toBe(all.withPreview < 60 ? all.withPreview : -1);
    const only = searchStyleCatalog('', 'hyperframes', 0, 60, '', { onlyPreview: true });
    expect(only.total).toBe(all.withPreview);
  });
});

describe('favourites', () => {
  it('lists a favourite that has no picture and sits in a hidden use (OneTake)', () => {
    const listed = searchStyleCatalog('', '', 0, 30, '', { favorites: ['onetake:workflow', 'lemo:art-deco'], onlyPreview: true, curated: true });
    expect(listed.entries.map((e) => e.id)).toEqual(['onetake:workflow', 'lemo:art-deco']);
  });

  it('keeps the newest first, ignores repeats, refuses unknown ids and lists favourites in that order', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { favorites, setFavorite } = await import('../src/favorites.ts');
    const dir = mkdtempSync(join(tmpdir(), 'qassa-fav-'));
    const file = join(dir, 'styles', 'favorites.json');
    const known = (id: string) => styleCatalog().entries.some((e) => e.id === id);
    try {
      expect(favorites(file)).toEqual([]);
      setFavorite('lemo:art-deco', true, file, known);
      setFavorite('hyperframes:ai-chat-reveal', true, file, known);
      setFavorite('lemo:art-deco', true, file, known);
      expect(favorites(file)).toEqual(['lemo:art-deco', 'hyperframes:ai-chat-reveal']);
      expect(() => setFavorite('nope:missing', true, file, known)).toThrow(/no style/);
      const listed = searchStyleCatalog('', '', 0, 30, '', { favorites: favorites(file), previewFirst: true });
      expect(listed.entries.map((e) => e.id)).toEqual(['lemo:art-deco', 'hyperframes:ai-chat-reveal']);
      expect(setFavorite('lemo:art-deco', false, file, known)).toEqual(['hyperframes:ai-chat-reveal']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('links a clip that shows the style for every Lemo film', () => {
    const lemo = styleCatalog().entries.filter((e) => e.source === 'lemo');
    expect(lemo.every((e) => e.video?.endsWith(`/releases/download/web/${e.id.slice(5)}.mp4`))).toBe(true);
  });
});
