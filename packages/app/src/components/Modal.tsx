import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Brand.tsx';
import { useStore } from '../lib/store.ts';

/** Native modal: browser focus containment and Escape, with explicit initial/return focus. */
/** wide: up to 1000px; full: most of the screen, its body fills the height (a gallery) */
export function Modal({ title, subtitle, onClose, children, wide = false, full = false, initialFocus }: { title: string; subtitle?: string; onClose(): void; children: ReactNode; wide?: boolean; full?: boolean; initialFocus?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => { dialog.close(); const target = returnFocus.current; requestAnimationFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }); }); };
  }, []);
  return <dialog ref={ref} dir="rtl" className={`qassa-modal ${full ? 'qassa-modal-full' : wide ? 'qassa-modal-wide' : ''}`} aria-label={title} onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="إغلاق النافذة"><Icon name="close" size={19} /></button></header>
    {children}
    <ModalFeedback />
  </dialog>;
}

function ModalFeedback() {
  const toast = useStore((s) => s.toast);
  const openedAt = useRef(Date.now());
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast || toast.at < openedAt.current) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!visible || !toast) return null;
  return <div className={`modal-feedback ${toast.kind === 'error' ? 'text-cut-text' : 'text-accent'}`} role={toast.kind === 'error' ? 'alert' : 'status'}><span>{toast.text}</span><button className="icon-button" aria-label="إغلاق الرسالة" onClick={() => setVisible(false)}><Icon name="close" /></button></div>;
}
