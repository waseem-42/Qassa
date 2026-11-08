import { useEffect, useMemo, useRef, useState } from 'react';
import { fillerCutOps, findFillers, sourceToTimeline, type Transcript, type WordState } from '@edit/shared';
import { useStore } from '../lib/store.ts';

// «كلمات الحشو»: the hesitations in this transcript, counted per kind, cut together in one undo step.

export function Fillers({ tr, states, mediaId }: { tr: Transcript; states: WordState[]; mediaId: string }) {
  const groups = useMemo(() => findFillers(tr.words, states), [tr, states]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const total = groups.reduce((n, g) => n + g.words.length, 0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    addEventListener('pointerdown', away); addEventListener('keydown', esc, true);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', esc, true); };
  }, [open]);
  if (!total) return null;
  const on = (key: string, def: boolean) => picked[key] ?? def;
  const chosen = groups.filter((g) => on(g.key, g.picked)).flatMap((g) => g.words);
  const listen = (i: number) => {
    const t = sourceToTimeline(useStore.getState().project!, mediaId, tr.words[i].t0);
    if (t !== null) { useStore.getState().seek(Math.max(0, t - 0.8)); useStore.getState().setPlaying(true); }
  };
  const cut = async () => {
    if (await useStore.getState().ops(fillerCutOps(mediaId, chosen))) {
      useStore.getState().notify(`انحذفت ${chosen.length} كلمة حشو — تقدر تتراجع بخطوة واحدة`, 'info');
      setOpen(false);
    }
  };
  return (
    <div ref={box} className="fillers">
      <button className="btn h-7 text-xs" aria-expanded={open} onClick={() => setOpen(!open)} title="أصوات التردد اللي تقدر تحذفها مرة وحدة">كلمات الحشو <span className="count-badge">{total}</span></button>
      {open && (
        <div className="fillers-pop" role="group" aria-label="كلمات الحشو">
          <p>اختر اللي تبي تحذفه؛ «يعني» و«اه» أحيانًا كلام مقصود، فما تنحدد إلا بطلبك.</p>
          {groups.map((g) => (
            <label key={g.key} className="fillers-row">
              <input type="checkbox" checked={on(g.key, g.picked)} onChange={(e) => setPicked({ ...picked, [g.key]: e.target.checked })} />
              <span>{g.label}</span>
              <span className="num text-ink-400">{g.words.length}</span>
              <button className="btn btn-ghost h-6 px-2 text-[11px]" onClick={(e) => { e.preventDefault(); listen(g.words[0]); }} title="اسمع أول واحدة">▶</button>
            </label>
          ))}
          <button className="btn btn-primary mt-1 w-full justify-center" disabled={!chosen.length} onClick={cut}>احذف المحدد ({chosen.length})</button>
        </div>
      )}
    </div>
  );
}
