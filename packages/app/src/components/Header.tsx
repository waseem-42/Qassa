import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BOTH_PANELS, useStore } from '../lib/store.ts';
import { Icon, Wordmark } from './Brand.tsx';
import { Checkpoints } from './Checkpoints.tsx';
import { ExportDialog } from './ExportDialog.tsx';
import { QuickExport } from './QuickExport.tsx';
import { RuntimeSettings, useRuntime } from './RuntimeSettings.tsx';
import { PopupMenu, type MenuItem } from './PopupMenu.tsx';
import { keysFor, prettyKey, useKeys } from '../lib/keys.ts';
import { useHeaderDialog, usePalette } from '../lib/palette.ts';
import { useLayout } from '../lib/layout.ts';
import { useMediaQuery } from '../lib/workspace-layout.ts';
import { StartGuide } from './StartGuide.tsx';

const PAGES = [['assistant', 'مساعد AI'], ['text', 'المونتاج بالنص'], ['inspect', 'الخصائص'], ['notes', 'التعليقات']] as const;

/** «النوافذ»: every panel and window of the editor, shown or hidden from one place (a closed panel comes back here). */
function WindowsMenu({ onDialog }: { onDialog(d: 'jobs' | 'checkpoints'): void }) {
  const [at, setAt] = useState<{ x: number; y: number }>();
  const panels = useStore((s) => s.panels), panel = useStore((s) => s.panel);
  const mediaOverlay = useStore((s) => s.mediaOverlay);
  const wide = useMediaQuery(BOTH_PANELS), mediaOn = wide ? panels.media : mediaOverlay;
  const hidden = useLayout((s) => s.hidden);
  const s = useStore.getState(), layout = useLayout.getState();
  const groups: MenuItem[][] = [
    [
      { label: 'مكتبة المشروع', checked: mediaOn, run: () => s.showPanel('media', !mediaOn) },
      ...PAGES.map(([id, label]) => { const on = panels.tools && panel === id; return { label, checked: on, run: () => (on ? s.showPanel('tools', false) : s.setPanel(id)) }; }),
    ],
    [
      { label: 'التايملاين', checked: !hidden.timeline, run: () => layout.setHidden('timeline', !hidden.timeline) },
      { label: 'شريط الأدوات الجانبي', checked: !hidden.rail, run: () => layout.setHidden('rail', !hidden.rail) },
    ],
    [
      { label: 'الستايلات', run: () => s.setStylesOpen(true) },
      { label: 'المهام', run: () => onDialog('jobs') },
      { label: 'نقاط الحفظ', run: () => onDialog('checkpoints') },
      { label: 'اختصارات لوحة المفاتيح', key: 'shortcuts', run: () => useKeys.getState().setOpen(true) },
    ],
    [{ label: 'إظهار الكل', run: () => { layout.setHidden('timeline', false); layout.setHidden('rail', false); s.showPanel('tools', true); s.showPanel('media', true); } }],
  ];
  return <>
    <button className="btn btn-ghost" aria-haspopup="menu" aria-expanded={!!at} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt(at ? undefined : { x: r.left, y: r.bottom + 4 }); }}>النوافذ</button>
    {at && <PopupMenu label="النوافذ" groups={groups} x={at.x} y={at.y} onClose={() => setAt(undefined)} />}
  </>;
}

export function Header() {
  const { name, projects, project, history, connection, jobs } = useStore(useShallow(({ name, projects, project, history, connection, jobs }) => ({ name, projects, project, history, connection, jobs })));
  const dialog = useHeaderDialog((s) => s.dialog), setDialog = useHeaderDialog.getState().setDialog;
  const paletteKey = useKeys((s) => keysFor('palette', s.custom)[0]);
  useEffect(() => { setDialog(undefined); }, [name]);
  const active = Object.values(jobs).filter((j) => ['queued', 'running'].includes(j.status));
  return <>
    <header className="app-header">
      <button className="brand-button" title="العودة إلى المشاريع" onClick={() => useStore.getState().close()}><Wordmark size={24} /></button>
      {project ? <>
        <span className="header-divider" />
        <div className="project-switch"><select aria-label="المشروع الحالي" value={name} onChange={(e) => useStore.getState().open(e.target.value)}>{projects.map((p) => <option key={p.name} value={p.name}>{p.displayName || p.name}</option>)}</select></div>
        <div className="history-controls"><button className="icon-button" aria-label="تراجع" title="تراجع · Ctrl+Z" disabled={!history.undo} onClick={() => useStore.getState().undo()}>↶</button><button className="icon-button" aria-label="إعادة" title="إعادة · Ctrl+Shift+Z" disabled={!history.redo} onClick={() => useStore.getState().redo()}>↷</button></div>
      </> : <span className="header-caption">استوديو المونتاج بالذكاء الاصطناعي</span>}
      <div className="header-spacer" />
      {project && <button className="btn command-trigger" aria-keyshortcuts={paletteKey} title="ابحث عن أي أمر بالاسم" onClick={() => usePalette.getState().setOpen(true)}><Icon name="search" size={16} /><span>ابحث عن أمر</span>{paletteKey && <kbd dir="ltr">{paletteKey.split('+').map(prettyKey).join('+')}</kbd>}</button>}
      <button className="btn btn-ghost" onClick={() => useRuntime.getState().setOpen(true)}>الإعدادات</button>
      {project && <WindowsMenu onDialog={(d) => { useStore.getState().setPlaying(false); setDialog(d); }} />}
      {project && <StartGuide key={name} compact />}
      {/* only a problem is worth the space: connected is the normal state */}
      <span className="connection-pill" data-connected={connection === 'connected'} role="status">{connection !== 'connected' && <><i />{connection === 'connecting' ? 'جارٍ الاتصال…' : 'انقطع الاتصال — أحاول مرة ثانية'}</>}</span>
      {project && <button className="btn checkpoint-trigger" aria-label="نقاط حفظ المشروع" title="نقاط حفظ المشروع" onClick={() => { useStore.getState().setPlaying(false); setDialog('checkpoints'); }}><Icon name="bookmark" size={17} /><span>نقاط الحفظ</span></button>}
      {project && <button className="btn task-button" onClick={() => setDialog('jobs')} title="التحليل والتصدير"><Icon name="clock" />المهام {active.length > 0 && <span className="count-badge">{active.length}</span>}</button>}
      {project && <QuickExport />}
    </header>
    {dialog && project && (dialog === 'checkpoints' ? <Checkpoints key={name} onClose={() => setDialog(undefined)} /> : <ExportDialog key={name} initial={dialog} onClose={() => setDialog(undefined)} />)}
    <RuntimeSettings />
  </>;
}

