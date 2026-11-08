import type { Op } from './ops.ts';
import type { Word } from './schema.ts';
import type { WordState } from './timeline.ts';

// Filler words, found in the transcript (Descript's "remove filler words"): hesitation sounds are picked by
// default; words that are fillers only sometimes («يعني», «اه» = yes) are offered unpicked.

export interface FillerGroup { key: string; label: string; picked: boolean; words: number[] }

/** Spelling-insensitive form: no tashkeel/tatweel/punctuation, one alef, lower-case Latin. */
export function fillerNorm(w: string): string {
  return w.replace(/[ً-ٰٟـ]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().replace(/[^\p{L}]/gu, '');
}

const GROUPS: { key: string; label: string; picked: boolean; test: RegExp }[] = [
  // «أم» (or) is a word; a hesitation stretches the m («مم» on its own is a hum)
  { key: 'mm', label: 'اممم / ممم', picked: true, test: /^(?:[اه]?م{2,}|ام{3,})$|^(?:hm+|mm+|um+|uhm+|erm+)$/ },
  { key: 'aa', label: 'آآ / إإ', picked: true, test: /^ا+$|^اه{2,}$|^ا{2,}ه+$|^(?:uh+|ah+|er+|eh+)$/ },
  { key: 'yani', label: 'يعني', picked: false, test: /^(?:و?يعني)$/ },
  { key: 'ah', label: 'اه / إيه', picked: false, test: /^(?:اه|ايه)$/ },
];

/** Filler groups among the words still in the edit (states: 'cut' words are skipped). Groups with no hits are left out. */
export function findFillers(words: Word[], states?: WordState[]): FillerGroup[] {
  const found = GROUPS.map((g) => ({ key: g.key, label: g.label, picked: g.picked, words: [] as number[] }));
  words.forEach((w, i) => {
    if (states?.[i] === 'cut') return;
    const n = fillerNorm(w.w);
    if (!n) return;
    const g = GROUPS.findIndex((x) => x.test.test(n));
    if (g >= 0) found[g].words.push(i);
  });
  return found.filter((g) => g.words.length);
}

/** One cut per run of neighbouring filler words, the last run first; empty when nothing is picked. */
export function fillerCutOps(mediaId: string, indices: number[]): Op[] {
  const sorted = [...new Set(indices)].sort((a, b) => a - b), runs: [number, number][] = [];
  for (const i of sorted) {
    const last = runs.at(-1);
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs.reverse().map(([from, to]) => ({ op: 'cut_words', mediaId, from, to }));
}
