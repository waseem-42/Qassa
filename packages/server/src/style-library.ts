import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.ts';

export interface LibraryEntry {
  id: string; source: string; title: string; category: string; description: string;
  tags: string[]; url: string; demoUrl?: string; duration?: number;
  mode: 'brief' | 'reference'; requirements: string; prompt?: string;
  /** upstream poster image / looping preview clip, linked (not downloaded) */
  thumb?: string; video?: string;
  /** where a hover preview starts in the clip (a long film opens on its titles) */
  videoStart?: number;
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
    lastModified = modified;
  }
  return cached;
}
/**
 * previewFirst: entries with a picture before the rest (the gallery); onlyPreview: just those;
 * favorites: only these ids, most recently added first.
 */
export function searchStyleCatalog(query = '', source = '', offset = 0, limit = 30, category = '', opts: { previewFirst?: boolean; onlyPreview?: boolean; favorites?: string[] } = {}) {
  const catalog = styleCatalog();
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const rank = opts.favorites && new Map(opts.favorites.map((id, i) => [id, i]));
  const available = catalog.entries.filter((e) => (!source || source === e.source) && (!rank || rank.has(e.id)));
  const categories = [...new Set(available.map((e) => e.category))].sort();
  let entries = available.filter((e) => (!category || category === e.category) && (!opts.onlyPreview || e.thumb) && words.every((w) => `${e.title} ${e.description} ${e.category} ${e.tags.join(' ')}`.toLocaleLowerCase().includes(w)));
  // stable: within each group the catalog order stays; across libraries they take turns, so the first page shows the range
  if (rank) entries.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  else if (opts.previewFirst) entries = [...interleave(entries.filter((e) => e.thumb)), ...entries.filter((e) => !e.thumb)];
  return {
    sources: catalog.sources.map((s) => ({ ...s, count: catalog.entries.filter((e) => e.source === s.id).length })),
    categories, syncedAt: catalog.syncedAt, total: entries.length, withPreview: entries.filter((e) => e.thumb).length,
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
