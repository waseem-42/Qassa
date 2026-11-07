import { create } from 'zustand';
import { MAIN_TRACK, type Track } from '@edit/shared';

export type RowSize = 'compact' | 'normal' | 'large';
const heights = { compact: { video: 64, overlay: 40, text: 32, audio: 40 }, normal: { video: 88, overlay: 56, text: 40, audio: 56 }, large: { video: 128, overlay: 88, text: 64, audio: 88 } };
export const rowHeight = (t: Track, size: RowSize, wave: boolean) => Math.max(heights[size][t.kind], wave && t.id === MAIN_TRACK ? 112 : 0);
function savedSize(): RowSize { try { const s = localStorage.getItem('timeline-row-size'); if (s === 'compact' || s === 'large') return s; } catch {} return 'normal'; }
export const useTimelineView = create<{ size: RowSize; maximised: boolean; setSize(s: RowSize): void; toggleMax(): void }>((set) => ({
  size: savedSize(), maximised: false,
  setSize(size) { try { localStorage.setItem('timeline-row-size', size); } catch {} set({ size }); },
  toggleMax: () => set((s) => ({ maximised: !s.maximised })),
}));
