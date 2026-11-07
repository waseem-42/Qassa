import { clipEnd, type Clip } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { lookKind } from '../lib/look.ts';
import { PopupMenu, type MenuItem } from './PopupMenu.tsx';
import { deleteOps } from '../lib/layout.ts';

// Right-click on a timeline clip: what can be done to it, with the shortcut beside each (CapCut / Resolve style).

export function ClipMenu({ clip, x, y, onClose }: { clip: Clip; x: number; y: number; onClose: () => void }) {
  const s = useStore.getState();
  const project = useStore((st) => st.project)!;
  const time = useStore((st) => st.time);
  const selected = useStore((st) => st.selected);
  const look = useStore((st) => st.look);
  const clipboard = useStore((st) => st.clipboard);

  const media = project.media.find((m) => m.id === clip.mediaId);
  const video = media?.kind === 'video' && project.tracks.find((t) => t.id === clip.trackId)?.kind !== 'audio';
  const inside = time > clip.start && time < clipEnd(clip);
  const ids = selected.includes(clip.id) ? selected : [clip.id];

  const groups: MenuItem[][] = [
    [
      { label: 'قص عند المؤشر', key: 'split', disabled: !inside, run: () => s.ops([{ op: 'split', clipId: clip.id, at: time }]) },
      { label: 'نسخ', key: 'copy', run: () => s.copyClips() },
      { label: 'لصق عند المؤشر', key: 'paste', disabled: !clipboard?.length, run: () => s.pasteClips() },
      { label: 'تكرار', key: 'duplicate', run: () => s.duplicateClips() },
    ],
    [
      { label: 'نسخ الخصائص', key: 'copyLook', run: () => s.copyLook(clip.id) },
      { label: 'لصق الخصائص', key: 'pasteLook', disabled: !look || look.kind !== lookKind(clip) || (ids.length === 1 && look.from === clip.id), run: () => s.pasteLook(ids) },
    ],
    ...(video ? [[
      { label: clip.picture?.off ? 'إظهار الصورة' : 'صوت فقط', disabled: !media?.hasAudio, run: () => s.ops([{ op: 'update_clip', clipId: clip.id, patch: { picture: { off: !clip.picture?.off } } }]) },
      { label: 'تجميد الصورة عند المؤشر', disabled: !inside, run: () => s.clipTool(clip.id, 'freeze', { at: time, duration: 2 }) },
      { label: media?.derived?.kind === 'reverse' ? 'إلغاء العكس' : 'عكس', run: () => s.clipTool(clip.id, 'reverse') },
      { label: 'فصل الصوت', disabled: !media?.hasAudio || clip.volume === 0, run: () => s.ops([{ op: 'detach_audio', clipId: clip.id }]) },
    ]] : []),
    [{ label: ids.length > 1 ? `حذف (${ids.length})` : 'حذف', key: 'delete', danger: true, run: () => { s.ops(deleteOps(ids)); s.select([]); } }],
  ];

  return <PopupMenu groups={groups} x={x} y={y} onClose={onClose} />;
}
