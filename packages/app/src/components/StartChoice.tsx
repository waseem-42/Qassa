import { defaultTracks, MAIN_TRACK, type Op, type Project, type ProjectStart } from '@edit/shared';

const STARTS = [['video', 'فيديو'], ['podcast', 'صوت / بودكاست'], ['empty', 'فارغ']] as const;
export function StartChoice({ value, onChange, disabled }: { value: ProjectStart; onChange: (start: ProjectStart) => void; disabled?: boolean }) {
  return <div className="flex flex-wrap gap-1" role="group" aria-label="بداية المشروع">{STARTS.map(([id, name]) => <button type="button" key={id} className="btn text-xs" aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}>{name}</button>)}</div>;
}

export function startShapeOps(p: Project, start: ProjectStart): Op[] {
  if (p.clips.length || p.media.length) throw new Error('اختيار البداية متاح للمشروع الفارغ فقط');
  return [
    ...p.tracks.filter((t) => t.id !== MAIN_TRACK).map((t): Op => ({ op: 'remove_track', trackId: t.id })),
    ...defaultTracks(start).filter((t) => t.id !== MAIN_TRACK).map((t): Op => ({ op: 'add_track', track: t })),
  ];
}
