import { create } from 'zustand';
import { makeId, mediaPlacementOps, type MediaTarget } from '@edit/shared';
import { projectPath } from './api.ts';
import { useStore } from './store.ts';

export const MEDIA_DRAG = 'application/x-qassa-media';
export const useMediaSelection = create<{ id?: string }>(() => ({}));
export let draggingMediaId: string | undefined;
export function setDraggingMedia(id?: string) { draggingMediaId = id; }
export const isFileDrag = (d: DataTransfer) => [...d.types].includes('Files');
interface Upload { id: string; project: string; file: File; progress: number; status: 'queued' | 'uploading' | 'processing' | 'error'; error?: string; target?: MediaTarget }
export const useUploads = create<{ items: Upload[] }>(() => ({ items: [] }));
const active = new Map<string, XMLHttpRequest>();
let running = false;
const patch = (id: string, fields: Partial<Upload>) => useUploads.setState((s) => ({ items: s.items.map((x) => x.id === id ? { ...x, ...fields } : x) }));

export function cancelUpload(id: string) {
  active.get(id)?.abort();
  useUploads.setState((s) => ({ items: s.items.filter((x) => x.id !== id) }));
}

export function importFiles(files: File[], target?: MediaTarget) {
  const { name, showPanel } = useStore.getState();
  if (!name || !files.length) return;
  useUploads.setState((s) => ({ items: [...s.items, ...files.map((file) => ({ id: makeId('upload'), project: name, file, progress: 0, status: 'queued' as const, target }))] }));
  showPanel('media', true);
  void drain();
}

async function drain() {
  if (running) return;
  running = true;
  try {
    // Preserve the user's file order: the first successful upload establishes the spine.
    for (let item; (item = useUploads.getState().items.find((x) => x.status === 'queued'));) {
      const u = item;
      patch(u.id, { status: 'uploading' });
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          active.set(u.id, xhr);
          const q = new URLSearchParams();
          if (u.target?.trackId) q.set('trackId', u.target.trackId);
          if (u.target?.at !== undefined) q.set('at', String(u.target.at));
          if (u.target?.newTrack) q.set('newTrack', '1');
          if (u.target?.trackIndex !== undefined) q.set('trackIndex', String(u.target.trackIndex));
          xhr.open('POST', `${projectPath(u.project)}/upload?${q}`);
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch(u.id, { progress: e.loaded / e.total }); };
          xhr.upload.onload = () => patch(u.id, { progress: 1, status: 'processing' });
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else { let message = `تعذّر الرفع (${xhr.status})`; try { message = JSON.parse(xhr.responseText).error ?? message; } catch {} reject(new Error(message)); }
          };
          xhr.onerror = () => reject(new Error('انقطع الاتصال أثناء الرفع'));
          xhr.onabort = () => reject(new DOMException('أُلغي الرفع', 'AbortError'));
          const fd = new FormData(); fd.append('file', u.file, u.file.name); xhr.send(fd);
        });
        cancelUpload(u.id);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') patch(u.id, { status: 'error', error: (e as Error).message });
      } finally { active.delete(u.id); }
    }
  } finally { running = false; }
}

export function placeMedia(mediaId: string, target: MediaTarget) {
  const s = useStore.getState(), p = s.project;
  const m = p?.media.find((m) => m.id === mediaId);
  if (!p || !m) return;
  try { return s.ops(mediaPlacementOps(p, m, target)); }
  catch (e) { s.notify((e as Error).message); }
}
