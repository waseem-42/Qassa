import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { keysFor, prettyKey, type ActionId } from '../lib/keys.ts';

/** checked: a toggle (shown with ✓); undefined: an action */
export interface MenuItem { label: string; run: () => void; key?: ActionId; disabled?: boolean; danger?: boolean; checked?: boolean }

/** A context menu at (x, y), kept inside the window; closes on outside press, Escape or window blur. */
export function PopupMenu({ groups, x, y, onClose, label }: { groups: MenuItem[][]; x: number; y: number; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(4, Math.min(x, innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    // the button that opened it toggles it on its own click (closing here first would reopen it)
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('[aria-haspopup="menu"][aria-expanded="true"]')) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc, true);
    addEventListener('blur', onClose);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc, true); removeEventListener('blur', onClose); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label={label} className="clip-menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {groups.filter((g) => g.length).map((g, i) => (
        <div key={i} className="clip-menu-group">
          {g.map((it) => (
            <button key={it.label} role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.checked} className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { onClose(); it.run(); }}>
              <span>{it.checked !== undefined && <span className="menu-check" aria-hidden="true">{it.checked ? '✓' : ''}</span>}{it.label}</span>
              {it.key && <kbd dir="ltr">{prettyKey(keysFor(it.key)[0] ?? '')}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
