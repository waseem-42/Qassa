import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.ts';
import { STYLE_USES, styleTitleOf, styleUseOf } from '@edit/shared';

export interface LibraryEntry {
  id: string; source: string; title: string; category: string; description: string;
  tags: string[]; url: string; demoUrl?: string; duration?: number;
  mode: 'brief' | 'reference'; requirements: string; prompt?: string;
  /** upstream poster image / looping preview clip, linked (not downloaded) */
  thumb?: string; video?: string;
  /** where a hover preview starts in the clip (a long film opens on its titles) */
  videoStart?: number;
  /** what it is for (STYLE_USES) and a readable title — added on load; Awesome's author kept apart */
  use?: string; author?: string;
}
interface Catalog {
  syncedAt: string;
  sources: { id: string; name: string; url: string; revision: string; license: string; licenseUrl: string }[];
  entries: LibraryEntry[];
}
let cached: Catalog | undefined;
let lastModified = -1;
export function styleCatalog(): Catalog {
  const file = join(ROOT, 'style-library/catalog.json');
  const modified = statSync(file).mtimeMs;
  if (!cached || modified !== lastModified) {
    cached = JSON.parse(readFileSync(file, 'utf8')) as Catalog;
    for (const e of cached.entries) { const t = styleTitleOf(e); Object.assign(e, { use: styleUseOf(e), title: t.title, ...(t.author ? { author: t.author } : {}) }); }
    lastModified = modified;
  }
  return cached;
}
/**
 * previewFirst: entries with a picture before the rest (the gallery); onlyPreview: just those;
 * favorites: only these ids, most recently added first.
 */
/**
 * curated (the editor's gallery): hidden uses (web toys, workflows) left out unless `all`, ordered by how well an
 * entry shows itself (a clip, then a picture) and by source (films, then scenes, then prompts); `uses` counts what
 * the other filters leave in each use. The agent's search stays uncurated.
 */
export function searchStyleCatalog(query = '', source = '', offset = 0, limit = 30, category = '', opts: { previewFirst?: boolean; onlyPreview?: boolean; favorites?: string[]; use?: string; curated?: boolean; all?: boolean } = {}) {
  const catalog = styleCatalog();
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const rank = opts.favorites && new Map(opts.favorites.map((id, i) => [id, i]));
  const hidden = new Set(opts.curated && !opts.all && !rank ? STYLE_USES.filter((u) => u.hidden).map((u) => u.id) : []);
  const available = catalog.entries.filter((e) => (!source || source === e.source) && (!rank || rank.has(e.id)) && !hidden.has(e.use!));
  const categories = [...new Set(available.map((e) => e.category))].sort();
  const matching = available.filter((e) => (!category || category === e.category) && (!opts.onlyPreview || e.thumb) && words.every((w) => `${e.title} ${e.author ?? ''} ${e.description} ${e.category} ${e.tags.join(' ')}`.toLocaleLowerCase().includes(w)));
  const uses = STYLE_USES.map((u) => ({ id: u.id, count: matching.filter((e) => e.use === u.id).length }));
  let entries = matching.filter((e) => !opts.use || e.use === opts.use);
  // stable: within each group the catalog order stays; across libraries they take turns, so the first page shows the range
  const SOURCE_ORDER: Record<string, number> = { lemo: 0, hyperframes: 1, awesome: 2 };
  const shows = (e: LibraryEntry) => (e.video ? 0 : e.thumb ? 1 : 2);
  if (rank) entries.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  else if (opts.curated) entries = [...entries].sort((a, b) => shows(a) - shows(b) || (SOURCE_ORDER[a.source] ?? 3) - (SOURCE_ORDER[b.source] ?? 3));
  else if (opts.previewFirst) entries = [...interleave(entries.filter((e) => e.thumb)), ...entries.filter((e) => !e.thumb)];
  return {
    sources: catalog.sources.map((s) => ({ ...s, count: catalog.entries.filter((e) => e.source === s.id).length })),
    categories, uses, syncedAt: catalog.syncedAt, total: entries.length, withPreview: entries.filter((e) => e.thumb).length,
    entries: entries.slice(offset, offset + limit).map(({ prompt, ...e }) => e),
  };
}

/** One entry from each source in turn, each source in its own order. */
function interleave(list: LibraryEntry[]): LibraryEntry[] {
  const bySource = new Map<string, LibraryEntry[]>();
  for (const e of list) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
  const queues = [...bySource.values()];
  const out: LibraryEntry[] = [];
  for (let i = 0; out.length < list.length; i++) for (const q of queues) if (i < q.length) out.push(q[i]);
  return out;
}
