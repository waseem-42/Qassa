import { create } from 'zustand';
import { MAIN_TRACK, type Track } from '@edit/shared';
import { useStore } from './store.ts';

export type RowSize = 'compact' | 'normal' | 'large';
const heights = { compact: { video: 64, overlay: 40, text: 32, audio: 40 }, normal: { video: 88, overlay: 56, text: 40, audio: 56 }, large: { video: 128, overlay: 88, text: 64, audio: 88 } };
/** custom: a height the user dragged for this track (its divider); otherwise the row size's */
export const rowHeight = (t: Track, size: RowSize, wave: boolean, custom?: number) => custom ?? Math.max(heights[size][t.kind], wave && t.id === MAIN_TRACK ? 112 : 0);
export const ROW_MIN = 24, ROW_MAX = 400;
function savedSize(): RowSize { try { const s = localStorage.getItem('timeline-row-size'); if (s === 'compact' || s === 'large') return s; } catch {} return 'normal'; }
function savedHeights(): Record<string, number> { try { return JSON.parse(localStorage.getItem('track-heights') ?? '{}'); } catch { return {}; } }
/** heights: per project and track (`name:trackId`), set by dragging the line under a track */
export const useTimelineView = create<{ size: RowSize; maximised: boolean; heights: Record<string, number>; setSize(s: RowSize): void; toggleMax(): void; setHeight(key: string, h: number | undefined, save?: boolean): void }>((set, get) => ({
  size: savedSize(), maximised: false, heights: savedHeights(),
  setSize(size) { try { localStorage.setItem('timeline-row-size', size); } catch {} set({ size }); },
  toggleMax: () => set((s) => ({ maximised: !s.maximised })),
  setHeight(key, h, save = true) {
    const next = { ...get().heights };
    if (h === undefined) delete next[key]; else next[key] = Math.round(Math.max(ROW_MIN, Math.min(ROW_MAX, h)));
    if (save) try { localStorage.setItem('track-heights', JSON.stringify(next)); } catch { /* private mode */ }
    set({ heights: next });
  },
}));

/** A track's row height in this project: its dragged height, or the row size's. */
export function useRowHeight(t: Track): number {
  const name = useStore((s) => s.name), wave = useStore((s) => s.largeWave);
  const size = useTimelineView((s) => s.size), custom = useTimelineView((s) => s.heights[`${name}:${t.id}`]);
  return rowHeight(t, size, wave, custom);
}
