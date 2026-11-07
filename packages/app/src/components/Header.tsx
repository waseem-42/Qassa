import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store.ts';
import { useKeys } from '../lib/keys.ts';
import { Icon, Wordmark } from './Brand.tsx';
import { Checkpoints } from './Checkpoints.tsx';
import { ExportDialog } from './ExportDialog.tsx';
import { RuntimeSettings, useRuntime } from './RuntimeSettings.tsx';

export function Header() {
  const { name, projects, project, history, connection, jobs } = useStore(useShallow(({ name, projects, project, history, connection, jobs }) => ({ name, projects, project, history, connection, jobs })));
  const [dialog, setDialog] = useState<'export' | 'jobs' | 'checkpoints'>();
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
      <button className="btn btn-ghost" onClick={() => useRuntime.getState().setOpen(true)}>الإعدادات</button>
      {/* only a problem is worth the space: connected is the normal state */}
      <span className="connection-pill" data-connected={connection === 'connected'} role="status">{connection !== 'connected' && <><i />{connection === 'connecting' ? 'جارٍ الاتصال…' : 'انقطع الاتصال — أحاول مرة ثانية'}</>}</span>
      {project && <button className="btn checkpoint-trigger" aria-label="نقاط حفظ المشروع" title="نقاط حفظ المشروع" onClick={() => { useStore.getState().setPlaying(false); setDialog('checkpoints'); }}><Icon name="bookmark" size={17} /><span>نقاط الحفظ</span></button>}
      {project && <button className="btn task-button" onClick={() => setDialog('jobs')} title="التحليل والتصدير"><Icon name="clock" />المهام {active.length > 0 && <span className="count-badge">{active.length}</span>}</button>}
      <button className="icon-button header-help" aria-label="اختصارات لوحة المفاتيح" onClick={() => useKeys.getState().setOpen(true)}><Icon name="keyboard" size={19} /></button>
      {project && <button className="btn btn-primary export-trigger" onClick={() => { useStore.getState().setPlaying(false); setDialog('export'); }}><Icon name="download" size={17} />تصدير</button>}
    </header>
    {dialog && project && (dialog === 'checkpoints' ? <Checkpoints key={name} onClose={() => setDialog(undefined)} /> : <ExportDialog key={name} initial={dialog} onClose={() => setDialog(undefined)} />)}
    <RuntimeSettings />
  </>;
}

