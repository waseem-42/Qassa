import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.ts';
import { useLayout } from '../lib/layout.ts';
import { guideExported, guideProgress, guideProjectKey, useStartGuide } from '../lib/start-guide.ts';
import { Icon } from './Brand.tsx';

const STEPS = ['أضف ملفاتك', 'ضعها على التايملاين', 'قص أو أضف نص', 'صدّر'];

export function StartGuide({ compact = false }: { compact?: boolean }) {
  const project = useStore((s) => s.project)!;
  const exported = useStore((s) => guideExported(s.project!, Object.values(s.jobs)));
  const { dismissed, edited, close } = useStartGuide();
  const [open, setOpen] = useState(false);
  const highlight = useRef<{ element: HTMLElement; timer: ReturnType<typeof setTimeout> }>();
  const frames = useRef<number[]>([]);
  const clear = () => {
    frames.current.forEach(cancelAnimationFrame); frames.current = [];
    if (highlight.current) { clearTimeout(highlight.current.timer); highlight.current.element.removeAttribute('data-guide-highlight'); highlight.current = undefined; }
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (!compact || !open) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open], [role="menu"]')) return;
      e.preventDefault(); e.stopPropagation(); setOpen(false);
    };
    addEventListener('keydown', escape, true);
    return () => removeEventListener('keydown', escape, true);
  }, [compact, open]);
  const show = (step: number) => {
    clear();
    setOpen(false);
    const store = useStore.getState(), layout = useLayout.getState();
    if (step < 2) store.showPanel('media', true);
    if (step === 2) layout.setHidden('timeline', false);
    frames.current.push(requestAnimationFrame(() => {
      if (step < 2) document.querySelector<HTMLButtonElement>('[data-guide-tab="media"]')?.click();
      frames.current.push(requestAnimationFrame(() => {
        const selector = step === 0 ? '[data-guide="import"]' : step === 1 ? '[data-media-id] .media-add' : step === 2 ? '[data-guide="edit"]' : '.export-trigger';
        const element = document.querySelector<HTMLElement>(selector) ?? (step === 1 ? document.querySelector<HTMLElement>('[data-media-list]') : null);
        if (!element) return;
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        element.focus({ preventScroll: true });
        element.setAttribute('data-guide-highlight', 'true');
        highlight.current = { element, timer: setTimeout(() => { element.removeAttribute('data-guide-highlight'); highlight.current = undefined; }, 2600) };
      }));
    }));
  };
  if (dismissed) return null;
  const done = guideProgress(project, edited.includes(guideProjectKey(project)), exported);
  const checklist = <section className="start-guide" aria-label="دليل البداية" dir="rtl">
    <div className="start-guide-heading"><strong>دليل البداية</strong><button className="icon-button" aria-label="إغلاق دليل البداية" title="إغلاق — يمكنك إعادته من الإعدادات" onClick={() => { clear(); close(); }}><Icon name="close" size={14} /></button></div>
    <ol>{STEPS.map((label, i) => <li key={label} data-complete={done[i]}><span className="guide-step-number" aria-label={done[i] ? 'اكتملت' : 'لم تكتمل'}>{done[i] ? '✓' : i + 1}</span><span>{label}</span><button type="button" aria-label={`وريني: ${label}`} onClick={() => show(i)}>وريني</button></li>)}</ol>
  </section>;
  // the full row is for the very start; after two steps it only takes room from the work
  const started = done.filter(Boolean).length >= 2;
  if (!compact) return started ? null : <div className="guide-full">{checklist}</div>;
  return <div className="guide-compact" data-started={started || undefined}>
    <button className="btn btn-ghost guide-trigger" aria-expanded={open} onClick={() => setOpen(!open)}><span>دليل البداية</span><bdi className="num">{done.filter(Boolean).length}/4</bdi></button>
    {open && <><button className="guide-backdrop" aria-label="طي دليل البداية" onClick={() => setOpen(false)} /><div className="guide-popover">{checklist}</div></>}
  </div>;
}
