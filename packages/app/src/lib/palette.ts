import { create } from 'zustand';

/** The command search (Ctrl+K): open state, plus the header dialogs it can open. */
export const usePalette = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** Header dialogs, here so the command search (and anything else) can open them. */
export type HeaderDialog = 'export' | 'jobs' | 'checkpoints';
export const useHeaderDialog = create<{ dialog?: HeaderDialog; setDialog(d?: HeaderDialog): void }>((set) => ({ setDialog: (dialog) => set({ dialog }) }));

/** Arabic search folding: no tashkeel/tatweel, one alef, ta marbuta = ha, alef maqsura = ya; Latin lower-cased. */
export function fold(text: string): string {
  return text.toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}

/** Every query word must start a word of the haystack (or appear inside it); earlier, whole-word hits rank higher. */
export function score(haystack: string, query: string): number {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return 1;
  const hay = fold(haystack), tokens = hay.split(/[\s/·()«»،,.-]+/);
  let total = 0;
  for (const w of words) {
    const exact = tokens.indexOf(w), at = tokens.findIndex((t) => t.startsWith(w)), al = w.length > 1 ? tokens.findIndex((t) => t.startsWith('ال' + w)) : -1;
    if (exact >= 0) total += 16 - Math.min(exact, 8);
    else if (at >= 0) total += 10 - Math.min(at, 8);
    else if (al >= 0) total += 7 - Math.min(al, 6);
    else if (hay.includes(w)) total += 1;
    else return 0;
  }
  return total;
}
