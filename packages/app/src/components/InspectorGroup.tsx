import { useState, type ReactNode } from 'react';

/** Viewer preference only: a changed value marks the closed group, never forces it open. */
export function InspectorGroup(props: { id: string; title: string; changed?: boolean; children: ReactNode }) {
  return <RememberedGroup key={props.id} {...props} />;
}

function RememberedGroup({ id, title, changed, children }: { id: string; title: string; changed?: boolean; children: ReactNode }) {
  const key = `qassa.inspector.group:${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === 'open'; } catch { return false; } });
  return <details className="fold inspector-group" data-inspector-group={id} open={open} onToggle={(e) => {
    const next = e.currentTarget.open;
    if (next === open) return;
    setOpen(next);
    try { localStorage.setItem(key, next ? 'open' : 'closed'); } catch { /* private mode */ }
  }}>
    <summary>{title}{changed && <span className="inspector-changed" role="img" aria-label="يحتوي قيمًا معدّلة" title="يحتوي قيمًا معدّلة">•</span>}</summary>
    {children}
  </details>;
}
