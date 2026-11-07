import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STYLE_PRESETS, OpError } from '@edit/shared';
import { DATA_DIR } from './config.ts';
import { styleCatalog } from './style-library.ts';
import { savedStyles } from './styles.ts';

// What the user liked in the styles window — library references, looks, saved styles — across all projects.
// Kept next to the saved styles; most recently added first.

export const FAVORITES_FILE = join(DATA_DIR, 'styles', 'favorites.json');

export function favorites(file = FAVORITES_FILE): string[] {
  if (!existsSync(file)) return [];
  try {
    const ids = JSON.parse(readFileSync(file, 'utf8')).ids;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return []; // a broken file reads as empty; the next change rewrites it
  }
}

/** Something the styles window shows: a library entry, a built-in look or a saved style. */
export function isFavoritable(id: string): boolean {
  return styleCatalog().entries.some((e) => e.id === id) || STYLE_PRESETS.some((s) => s.id === id) || savedStyles().some((s) => s.id === id);
}

export function setFavorite(id: string, on: boolean, file = FAVORITES_FILE, known = isFavoritable): string[] {
  const ids = favorites(file).filter((x) => x !== id);
  if (on) {
    if (!known(id)) throw new OpError(`no style ${id} to add to favourites`);
    ids.unshift(id);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ ids }, null, 2));
  renameSync(`${file}.tmp`, file);
  return ids;
}
