import { create } from 'zustand';
import { api } from './api.ts';
import { useStore } from './store.ts';

// What the user liked in the styles window (library references, looks, saved styles). Kept by the server
// for all projects; a change made in another window arrives over the live socket.

interface Favorites {
  ids: string[];
  load(): Promise<void>;
  toggle(id: string): Promise<void>;
}

export const useFavorites = create<Favorites>((set, get) => ({
  ids: [],
  async load() {
    try { set({ ids: (await api.get<{ ids: string[] }>('/api/style-library/favorites')).ids }); }
    catch { /* the hearts stay empty; the next change or reconnect reloads */ }
  },
  async toggle(id) {
    const before = get().ids;
    const on = !before.includes(id);
    set({ ids: on ? [id, ...before] : before.filter((x) => x !== id) }); // the heart answers at once
    try {
      const res = await fetch(`/api/style-library/favorites/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      set({ ids: body.ids });
    } catch (e) {
      set({ ids: before });
      useStore.getState().notify(`تعذّر تحديث المفضلة: ${(e as Error).message}`);
    }
  },
}));

export const useIsFavorite = (id: string) => useFavorites((s) => s.ids.includes(id));
