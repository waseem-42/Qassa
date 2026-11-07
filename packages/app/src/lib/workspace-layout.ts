import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query), update = () => setMatches(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export const SPLIT_KEY = 'qassa.workspace-split';
export function readSplit(available: number): number {
  try {
    const saved = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved < 1) return saved;
    // Old defaults saved a tall track stack even when CSS capped its visible height.
    const old = Number(localStorage.getItem('timeline-height'));
    if (old >= 160 && old <= available * .45) return old / available;
  } catch { /* private mode */ }
  return .4;
}
export function timelineSize(available: number, ratio: number, maximised = false): number {
  const max = Math.max(160, available - 220);
  return Math.round(Math.max(160, Math.min(max, maximised ? max : available * ratio)));
}
export function saveSplit(ratio: number) {
  try { localStorage.setItem(SPLIT_KEY, String(ratio)); } catch { /* keep it for this session */ }
}
