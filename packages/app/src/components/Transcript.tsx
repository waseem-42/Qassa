import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, MAIN_TRACK, clipEnd, speechClips, sourceToTimeline, timelineToSource, wordStates, type Project, type Transcript as T, type WordState } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { TranscribeButton } from './Transcribe.tsx';

// Edit by text: select words, Delete cuts them, Restore brings them back. Words that are
// cut are struck through; analysis/Claude suggestions are highlighted red until resolved.

export function Transcript() {
  const project = useStore((s) => s.project)!;
  const transcripts = useStore((s) => s.transcripts);
  const sources = project.media.filter((m) => m.hasAudio || m.kind === 'audio');
  const [mediaId, setMediaId] = useState<string>();
  const mid = mediaId && sources.some((s) => s.id === mediaId) ? mediaId : sources[0]?.id;
  const tr = mid ? transcripts[mid] : undefined;
  const media = sources.find((s) => s.id === mid);

  if (!sources.length) return <Empty text="ما فيه مقطع بعد. ارفع مقطعك من قائمة الوسائط." />;
  return (
    <div className="flex h-full flex-col">
      {sources.length > 1 && (
        <div className="border-b border-ink-800 p-2">
          <select className="field w-full" value={mid} onChange={(e) => setMediaId(e.target.value)}>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {tr ? tr.words.length ? <Words key={mid} tr={tr} project={project} mediaId={mid!} /> : <Empty text="اكتمل التفريغ ولم يُكتشف كلام في هذا الملف." /> : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-ink-400"><p>{media?.analyzed.includes('transcribe') ? 'تعذّر تحميل التفريغ؛ يمكنك إعادة تفريغه.' : 'يحتاج تفريغ — يبدأ فقط بطلبك.'}</p><TranscribeButton mediaId={mid!} /></div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-ink-500">{text}</div>;
}

function Words({ tr, project, mediaId }: { tr: T; project: Project; mediaId: string }) {
  const { ops, seek, setPlaying } = useStore.getState();
  const onMain = project.clips.some((c) => c.trackId === MAIN_TRACK && c.mediaId === mediaId);
  const states = useMemo(() => onMain ? wordStates(project, mediaId, tr.words) : tr.words.map((w): WordState => project.clips.some((c) => c.mediaId === mediaId && (w.t0 + w.t1) / 2 >= c.in && (w.t0 + w.t1) / 2 < c.out) ? 'keep' : 'cut'), [project, mediaId, tr, onMain]);
  const [sel, setSel] = useState<[number, number]>();
  const anchor = useRef<number>();
  const dragging = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const range = sel ? [Math.min(...sel), Math.max(...sel)] as const : undefined;

  // highlight the word under the playhead without re-rendering the whole list
  useEffect(() => {
    let last = -1;
    const update = (t: number, follow: boolean) => {
      const p = useStore.getState().project!;
      const free = speechClips(p).find((c) => c.mediaId === mediaId && c.start <= t && clipEnd(c) > t);
      const hit = timelineToSource(p, t) ?? (free ? { clip: free, src: free.in + (t - free.start) * free.speed } : null);
      let idx = -1;
      if (hit && hit.clip.mediaId === mediaId) {
        let lo = 0, hi = tr.words.length - 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          if (tr.words[m].t1 < hit.src) lo = m + 1;
          else hi = m - 1;
        }
        idx = lo < tr.words.length && tr.words[lo].t0 <= hit.src + 0.05 ? lo : -1;
      }
      if (idx === last) return;
      box.current?.querySelector(`[data-i="${last}"]`)?.removeAttribute('data-now');
      const el = box.current?.querySelector(`[data-i="${idx}"]`);
      el?.setAttribute('data-now', 'true');
      if (el && follow) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      last = idx;
    };
    update(useStore.getState().time, false);
    return useStore.subscribe((s, p) => s.time !== p.time && update(s.time, s.playing));
  }, [tr, mediaId]);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const cut = () => onMain && range && ops([{ op: 'cut_words', mediaId, from: range[0], to: range[1] }]).then(() => setSel(undefined));
  const restore = () => {
    if (!range || !onMain) return;
    const a = tr.words[range[0]], b = tr.words[range[1]];
    const prevEnd = tr.words[range[0] - 1]?.t1 ?? 0;
    const nextStart = tr.words[range[1] + 1]?.t0 ?? a.t0 + 1e6;
    ops([{ op: 'restore_range', mediaId, t0: Math.max(prevEnd, a.t0 - 0.15), t1: Math.min(nextStart, b.t1 + 0.15) }]).then(() => setSel(undefined));
  };
  const speed = (x: number) => {
    if (!range || !onMain) return;
    ops([{ op: 'speed_range', mediaId, t0: tr.words[range[0]].t0 - 0.05, t1: tr.words[range[1]].t1 + 0.05, speed: x }]);
  };

  // keyboard: Delete cuts the selection, Escape clears it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (!range || (e.target instanceof Element && e.target.closest('input,textarea,select'))) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cut();
      } else if (e.key === 'Escape') setSel(undefined);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const play = (i: number) => {
    const w = tr.words[i];
    const p = useStore.getState().project!;
    const free = p.clips.find((c) => c.mediaId === mediaId && w.t0 >= c.in && w.t0 < c.out);
    const t = sourceToTimeline(p, mediaId, w.t0) ?? (free ? free.start + (w.t0 - free.in) / free.speed : null);
    if (t !== null) seek(t);
  };

  const selCut = range ? states.slice(range[0], range[1] + 1).every((s) => s === 'cut') : false;
  const cutCount = states.filter((s) => s === 'cut').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-ink-800 px-2">
        {range ? (
          <>
            <span className="text-xs text-ink-400">{range[1] - range[0] + 1} كلمة</span>
            <div className="flex-1" />
            {selCut ? (
              <button className="btn h-7" disabled={!onMain} onClick={restore}>↺ استرجاع</button>
            ) : (
              <>
                <button className="btn h-7 border-cut/60 text-cut-text" disabled={!onMain} onClick={cut}>✂ قص <kbd className="text-[10px] text-ink-500">Del</kbd></button>
                <button className="btn h-7" disabled={!onMain} onClick={() => speed(2)} title="تسريع الجزء">×2</button>
                <button className="btn h-7" onClick={() => { play(range[0]); setPlaying(true); }}>▶</button>
              </>
            )}
          </>
        ) : (
          <span className="text-xs text-ink-500">
            {tr.words.length} كلمة · محذوف {cutCount} · <span className="num">{tr.model.split('@')[0]}</span> — {onMain ? 'حدّد كلمات بالسحب ثم Delete' : 'للقص بالكلمات ضع الملف على الأساسي؛ يمكنك استعراضه وتوليد كابشن هنا'}
          </span>
        )}
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[15px] leading-[2.1]" dir="rtl" onPointerLeave={() => (dragging.current = false)}>
        {tr.segments.map((s, si) => {
          const gap = si ? s.t0 - tr.segments[si - 1].t1 : s.t0;
          return (
            <Para
              key={si}
              w0={s.w0}
              w1={s.w1}
              t0={s.t0}
              gap={gap}
              tr={tr}
              states={states}
              range={range}
              onDown={(i, shift) => {
                if (shift && anchor.current !== undefined) setSel([anchor.current, i]);
                else {
                  anchor.current = i;
                  setSel([i, i]);
                  play(i);
                }
                dragging.current = true;
              }}
              onEnter={(i) => dragging.current && anchor.current !== undefined && setSel([anchor.current, i])}
            />
          );
        })}
      </div>
    </div>
  );
}

const Para = memo(function Para(props: {
  w0: number; w1: number; t0: number; gap: number; tr: T; states: WordState[]; range?: readonly [number, number];
  onDown: (i: number, shift: boolean) => void; onEnter: (i: number) => void;
}) {
  const { w0, w1, t0, gap, tr, states, range, onDown, onEnter } = props;
  const words = [];
  for (let i = w0; i <= w1; i++) {
    const w = tr.words[i];
    const inSel = !!range && i >= range[0] && i <= range[1];
    words.push(
      <span
        key={i}
        data-i={i}
        className="word"
        data-state={states[i]}
        data-sel={inSel || undefined}
        data-low={(w.p ?? 1) < 0.4 || undefined}
        onPointerDown={(e) => { e.preventDefault(); onDown(i, e.shiftKey); }}
        onPointerEnter={() => onEnter(i)}
      >
        {w.w}
      </span>,
      ' ',
    );
  }
  return (
    <p className="mb-2">
      {gap >= 0.8 && <span className="ml-2 inline-block rounded bg-ink-800 px-1.5 text-[11px] leading-5 text-ink-500" title="سكتة">⏸ {gap.toFixed(1)}ث</span>}
      <span className="num ml-2 text-[10px] text-ink-600">{fmtTime(t0, 0)}</span>
      {words}
    </p>
  );
}, (a, b) => {
  // re-render a paragraph only when its words or the selection over it changed
  const touches = (p: typeof a) => !!p.range && p.range[0] <= p.w1 && p.range[1] >= p.w0;
  return a.states === b.states && a.tr === b.tr && (a.range === b.range || (!touches(a) && !touches(b)));
});
