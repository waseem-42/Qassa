import { useEffect, useState } from 'react';
import { animValue, clipDuration, type AnimProp, type Clip, type Ease, type Op } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { EASES, easePatch, KEY_NEAR, keyAtTime, toggleKeyPatch, valuesPatch } from '../lib/anim.ts';

// Small controls shared by the inspector panels.

export function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2 py-1" title={hint}>
      {/* the label sits level with the first line of the control, however tall the control grows */}
      <span className="flex min-h-[26px] items-center text-xs text-ink-400">{label}</span>
      {children}
    </label>
  );
}

/** Slider that previews live while dragging and saves one undo step on release. */
/**
 * A value slider: drag it, or click the number and type one (in the units it shows: 50 for 50%),
 * Enter to apply, Esc to cancel. Double-click the slider to go back to `def`.
 */
export function Slider({ value, min, max, step, onPreview, onCommit, fmt, def, hardMin = min, hardMax = max, onReset, changed }: {
  value: number; min: number; max: number; step: number; onPreview: (v: number) => void; onCommit: (v: number) => void; fmt?: (v: number) => string; def?: number;
  /** a typed value may go past the slider's track, up to these */
  hardMin?: number; hardMax?: number;
  /** ↺ beside the value (shown when it differs from `def`, or when `changed`): `def` again, or this instead */
  onReset?: () => void; changed?: boolean;
}) {
  const [v, setV] = useState(value);
  const [text, setText] = useState<string>();
  useEffect(() => setV(value), [value]);
  // what one unit of the value reads as (100 for a percentage), so typed numbers mean what is shown
  const k = fmt ? Number.parseFloat(fmt(1).replace(/[^\d.+-]/g, '')) || 1 : 1;
  const set = (n: number) => { const x = Math.min(hardMax, Math.max(hardMin, n)); setV(x); onCommit(x); };
  const typed = () => {
    if (text === undefined) return;
    const n = Number.parseFloat(text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,٫]/g, '.'));
    setText(undefined);
    if (Number.isFinite(n)) set(n / k);
  };
  return (
    <div className="flex items-center gap-2" dir="ltr">
      <input type="range" min={min} max={max} step={step} value={v} title={def !== undefined ? 'دبل كلك يرجّع الافتراضي' : undefined}
        style={{ '--fill': `${((v - min) / (max - min || 1)) * 100}%` } as React.CSSProperties}
        onChange={(e) => { const n = Number(e.target.value); setV(n); onPreview(n); }}
        // only the keys that move it save (Ctrl+Z released on it must not save the old value back over the undo)
        onPointerUp={() => onCommit(v)} onKeyUp={(e) => { if (/^(Arrow|Page|Home|End)/.test(e.key)) onCommit(v); }}
        onDoubleClick={() => { if (def !== undefined) set(def); }} />
      <input className="slider-value num" aria-label="القيمة" title={hardMin < min || hardMax > max ? 'اكتب أي قيمة — تقدر تتجاوز حدود الشريط' : undefined} value={text ?? (fmt ? fmt(v) : v.toFixed(2))}
        onFocus={(e) => { setText(String(Math.round(v * k * 1000) / 1000)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setText(e.target.value)} onBlur={typed}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(undefined); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); } }} />
      {def !== undefined && (() => {
        const dirty = changed ?? Math.abs(v - def) > step / 2;
        // always takes its place, so the row doesn't shift when it appears
        return <button type="button" className="reset-value" style={{ visibility: dirty ? 'visible' : 'hidden' }} aria-hidden={!dirty} tabIndex={dirty ? 0 : -1}
          title={`إعادة للافتراضي (${fmt ? fmt(def) : def})`} aria-label="إعادة للافتراضي" onClick={(e) => { e.preventDefault(); if (onReset) onReset(); else set(def); }}>↺</button>;
      })()}
    </div>
  );
}

/**
 * A slider for a property that can change over the clip (place, opacity, volume): it shows and edits the value at the
 * playhead; ◆ adds a key there (or removes the one there), ‹ › jump to the key before / after.
 */
export function KeySlider({ clip, prop, min, max, step, fmt, def, hardMin, hardMax }: { clip: Clip; prop: AnimProp; min: number; max: number; step: number; fmt?: (v: number) => string; def?: number; hardMin?: number; hardMax?: number }) {
  const { preview, commit, seek } = useStore.getState();
  const time = useStore((s) => s.time);
  const t = Math.min(Math.max(0, time - clip.start), clipDuration(clip));
  const keys = clip.anim?.[prop] ?? [];
  const here = keyAtTime(keys, t);
  const prev = [...keys].reverse().find((k) => k.t < t - KEY_NEAR), next = keys.find((k) => k.t > t + KEY_NEAR);
  const ops = (v: number): Op[] => [{ op: 'update_clip', clipId: clip.id, patch: valuesPatch(clip, { [prop]: v }, t) }];
  return (
    <div className="min-w-0">
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1"><Slider value={animValue(clip, prop, t)} min={min} max={max} step={step} fmt={fmt} def={def} hardMin={hardMin} hardMax={hardMax}
        changed={def === undefined ? undefined : keys.length > 0 || Math.abs(animValue(clip, prop, t) - def) > step / 2}
        onReset={def === undefined ? undefined : () => commit([{ op: 'update_clip', clipId: clip.id, patch: { ...valuesPatch({ ...clip, anim: undefined }, { [prop]: def }, t), ...(keys.length ? { anim: { [prop]: null } } : {}) } }])}
        onPreview={(v) => preview(ops(v))} onCommit={(v) => commit(ops(v))} /></div>
      <div className="key-nav" dir="ltr">
        <button className="key-step" disabled={!prev} title="نقطة الحركة السابقة" aria-label="نقطة الحركة السابقة" onClick={() => prev && seek(clip.start + prev.t)}>‹</button>
        <button className="key-btn" aria-pressed={!!here} data-keyed={keys.length > 0} aria-label={here ? 'احذف نقطة الحركة عند المؤشر' : 'أضف نقطة حركة عند المؤشر'}
          title={here ? 'احذف نقطة الحركة عند المؤشر' : 'أضف نقطة حركة عند المؤشر'}
          onClick={() => commit([{ op: 'update_clip', clipId: clip.id, patch: toggleKeyPatch(clip, prop, t) }])}>◆</button>
        <button className="key-step" disabled={!next} title="نقطة الحركة التالية" aria-label="نقطة الحركة التالية" onClick={() => next && seek(clip.start + next.t)}>›</button>
      </div>
    </div>
      {here && next && <EaseRow value={here.ease} onPick={(v) => commit([{ op: 'update_clip', clipId: clip.id, patch: easePatch(clip, prop, t, v) }])} />}
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="border-b border-ink-800 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="panel-title flex-1">{title}</span>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** How a value moves from the key at the playhead to the next one (shown when there is a next key). */
export function EaseRow({ value, onPick }: { value: Ease | undefined; onPick: (e: Ease) => void }) {
  const on = value ?? 'smooth';
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-0.5 text-[10px] text-ink-500" title="كيف تتحرك القيمة من هذا المفتاح للي بعده">
      <span className="me-0.5">منحنى:</span>
      {EASES.map(([v, label]) => (
        <button key={v} className={`btn btn-ghost h-5 px-1.5 text-[10px] ${on === v ? 'text-accent' : ''}`} aria-pressed={on === v} onClick={() => onPick(v)}>{label}</button>
      ))}
    </div>
  );
}
