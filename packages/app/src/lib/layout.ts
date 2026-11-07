import { create } from 'zustand';
import type { Op } from '@edit/shared';

/** Deleting clips: with the main-track magnet off, a main-track clip leaves its space as a gap. */
export const deleteOps = (ids: string[]): Op[] => ids.map((clipId) => ({ op: 'delete' as const, clipId, ...(useLayout.getState().mainMagnet ? {} : { lift: true }) }));

/** Which parts of the editor are hidden (the «النوافذ» menu), remembered on this device. */
type Part = 'timeline' | 'rail';
const read = (): Record<Part, boolean> => { try { return { timeline: false, rail: false, ...JSON.parse(localStorage.getItem('hidden-parts') ?? '{}') }; } catch { return { timeline: false, rail: false }; } };
const readMainMagnet = () => { try { return localStorage.getItem('main-magnet') !== '0'; } catch { return true; } };
const readFocus = () => { try { return localStorage.getItem('show-focus') === '1'; } catch { return false; } };
/** showFocus: draw the zoom focus point and a layer's anchor on the preview (a toggle in «زوم وتركيز») */
/** mainMagnet: the main track closes up (default); off, its clips move freely in time and deleting leaves a gap */
export const useLayout = create<{ hidden: Record<Part, boolean>; setHidden(part: Part, hidden: boolean): void; showFocus: boolean; setShowFocus(on: boolean): void; mainMagnet: boolean; setMainMagnet(on: boolean): void }>((set, get) => ({
  hidden: read(),
  mainMagnet: readMainMagnet(),
  setMainMagnet(on) { try { localStorage.setItem('main-magnet', on ? '1' : '0'); } catch { /* private mode */ } set({ mainMagnet: on }); },
  showFocus: readFocus(),
  setShowFocus(on) { try { localStorage.setItem('show-focus', on ? '1' : '0'); } catch { /* private mode */ } set({ showFocus: on }); },
  setHidden(part, hidden) {
    const next = { ...get().hidden, [part]: hidden };
    try { localStorage.setItem('hidden-parts', JSON.stringify(next)); } catch { /* private mode */ }
    set({ hidden: next });
  },
}));
