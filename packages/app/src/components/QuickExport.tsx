import { useEffect, useRef, useState } from 'react';
import { markedRange } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { quickExport, useQuickExport } from '../lib/quick-export.ts';
import { useHeaderDialog } from '../lib/palette.ts';
import { api, projectPath } from '../lib/api.ts';
import { Icon } from './Brand.tsx';
import { PopupMenu } from './PopupMenu.tsx';

export function QuickExport() {
  const project = useStore((s) => s.project)!, name = useStore((s) => s.name)!;
  const jobs = useStore((s) => s.jobs), checking = useQuickExport((s) => s.checking), notice = useQuickExport((s) => s.notice);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const since = useRef(Date.now()), seen = useRef(new Set<string>());
  useEffect(() => { since.current = Date.now(); seen.current.clear(); }, [name]);
  useEffect(() => {
    const recent = Object.values(jobs).filter((j) => j.kind === 'render' && j.project === name && j.createdAt >= since.current).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!recent) return;
    if (['queued', 'running'].includes(recent.status)) { useQuickExport.setState({ notice: undefined }); return; }
    if (!['done', 'error'].includes(recent.status) || seen.current.has(recent.id)) return;
    seen.current.add(recent.id);
    useQuickExport.setState({ notice: { project: name, job: recent, warnings: useQuickExport.getState().warnings[recent.render?.snapshotId ?? recent.result?.snapshotId ?? ''] ?? 0 } });
  }, [jobs, name]);
  const active = Object.values(jobs).find((j) => j.kind === 'render' && ['queued', 'running'].includes(j.status));
  return <>
    <div className="export-split">
      <button className="btn btn-primary export-trigger" disabled={checking} onClick={() => void quickExport()}><Icon name="download" size={17} />{checking ? 'جارٍ الفحص…' : active ? `تصدير ${Math.round(active.progress * 100)}%` : 'تصدير'}</button>
      <button className="btn btn-primary export-options" aria-label="خيارات التصدير" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? undefined : { x: r.left, y: r.bottom + 4 }); }}>▾</button>
    </div>
    {menu && <PopupMenu label="خيارات التصدير" x={menu.x} y={menu.y} onClose={() => setMenu(undefined)} groups={[[
      { label: 'إعدادات التصدير', run: () => useHeaderDialog.getState().setDialog('export') },
      ...(markedRange(project) ? [{ label: 'صدّر المحدد', run: () => { void quickExport(true); } }] : []),
    ]]} />}
    {notice && <div className="export-notice" role={notice.job.status === 'error' ? 'alert' : 'status'}>
      <div><strong>{notice.job.status === 'error' ? 'تعذّر التصدير' : 'اكتمل التصدير'}</strong><p dir="auto">{notice.job.status === 'error' ? notice.job.error : `${notice.job.result?.output?.split('/').pop() ?? ''} · ${Number(notice.job.result?.duration ?? 0).toFixed(1)} ث`}</p></div>
      {notice.job.status === 'done' && <>
        <a className="btn" href={notice.job.result?.url} target="_blank" rel="noreferrer">تشغيل</a>
        <button className="btn" onClick={() => api.post(`${projectPath(notice.project)}/renders/reveal`, { output: notice.job.result?.output }).catch((e) => useStore.getState().notify(e.message))}>إظهار في المجلد</button>
      </>}
      {(notice.job.status === 'error' || notice.warnings > 0) && <button className="btn" onClick={() => useHeaderDialog.getState().setDialog('export')}>{notice.job.status === 'error' ? 'افتح التفاصيل' : `${notice.warnings} ملاحظات للمراجعة`}</button>}
      <button className="icon-button" aria-label="إغلاق إشعار التصدير" onClick={() => useQuickExport.getState().dismiss()}><Icon name="close" /></button>
    </div>}
  </>;
}
