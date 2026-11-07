import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { api } from '../lib/api.ts';
import { Modal } from './Modal.tsx';
import { Icon } from './Brand.tsx';
import { keysFor, prettyKey, useKeys } from '../lib/keys.ts';
import { useStartGuide } from '../lib/start-guide.ts';

interface Runtime {
  desktop: boolean; ready: boolean; dataDir: string; gpu?: string; estimatedGB: number; claude: boolean; claudeCommand: string;
  state?: { status: string; stage: string; progress: number; downloaded?: number; total?: number; message?: string };
}
export const useRuntime = create<{ runtime?: Runtime; open: boolean; setOpen(open: boolean): void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
const size = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB`;

export function RuntimeSettings() {
  const { runtime: r, open, setOpen } = useRuntime();
  const offered = useRef(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const runtime = await api.get<Runtime>('/api/runtime');
        if (!live) return;
        useRuntime.setState({ runtime });
        if (runtime.desktop && !runtime.ready && !offered.current) { offered.current = true; setOpen(true); }
      } catch { /* reconnecting server: preserve the last known setup state */ }
    };
    void load(); const timer = setInterval(load, 2500); return () => { live = false; clearInterval(timer); };
  }, []);
  const action = async (action: string) => {
    setError(''); try { await api.post('/api/runtime/setup', { action }); useRuntime.setState({ runtime: await api.get<Runtime>('/api/runtime') }); } catch (e) { setError((e as Error).message); }
  };
  if (!open) return null;
  return <Modal title="إعدادات قَصّة" subtitle="أدوات الجهاز وربط المساعد" onClose={() => setOpen(false)}><div className="modal-body space-y-5">
    <section className="space-y-3"><h3>البداية</h3><button className="btn" onClick={() => { useStartGuide.getState().show(); setOpen(false); }}>أعد عرض دليل البداية</button></section>
    <section className="space-y-3"><h3 className="text-ink-100">لوحة المفاتيح</h3>
      <p className="text-sm text-ink-400">كل الاختصارات، وتقدر تغيّر أي واحد منها.{keysFor('shortcuts')[0] && <> أو اضغط <kbd dir="ltr">{prettyKey(keysFor('shortcuts')[0])}</kbd> من أي مكان.</>}</p>
      <button className="btn" onClick={() => { setOpen(false); useKeys.getState().setOpen(true); }}><Icon name="keyboard" size={16} /> اختصارات لوحة المفاتيح</button>
    </section>
    {!r ? <p role="status">جارٍ قراءة حالة الجهاز…</p> : <>
      <section className="space-y-3"><h3 className="text-ink-100">أدوات التحليل والتفريغ</h3>
        {r.desktop ? <>
          <p className="text-sm text-ink-400">{r.ready ? 'اكتمل التجهيز — التحليل والتفريغ جاهزان.' : `تنزيل أول مرة، نحو ${r.estimatedGB} GB. يمكنك إكمال المونتاج والتصدير أثناء التجهيز؛ التحليل والتفريغ يحتاجان اكتماله.`}</p>
          <p className="text-xs text-ink-400">{r.gpu ? `NVIDIA · ${r.gpu}` : 'CPU int8 — لا توجد بطاقة NVIDIA متاحة؛ التفريغ سيكون أبطأ.'}</p>
          {r.state && !r.ready && <div className="space-y-2" aria-live="polite"><p>{r.state.stage || 'جاهز لبدء التنزيل'}</p><progress className="job-progress w-full" max={1} value={r.state.progress} />{!!r.state.downloaded && <p className="num text-xs" dir="ltr">{size(r.state.downloaded)}{r.state.total ? ` / ${size(r.state.total)}` : ''}</p>}{r.state.message && <p className="max-h-24 overflow-auto break-words text-xs text-ink-400" dir="auto">{r.state.message}</p>}</div>}
          {!r.ready && <button className="btn btn-primary" onClick={() => action(r.state?.status === 'running' ? 'pause' : 'start')}>{r.state?.status === 'running' ? 'إيقاف مؤقت' : r.state?.status === 'error' ? 'إعادة المحاولة' : r.state?.status === 'paused' ? 'استئناف التجهيز' : 'ابدأ التجهيز'}</button>}
        </> : <p className="text-sm text-ink-400">نسخة التطوير تستخدم أدوات الجهاز وبيئة setup.ps1.</p>}
      </section>
      <section className="space-y-3 border-t border-ink-800 pt-4"><h3>Claude Code</h3><p className="text-sm text-ink-400">{r.claude ? 'Claude Code موجود على الجهاز.' : 'لم أجد أمر claude. ثبّت Claude Code لاستخدام مهام المساعد؛ المحرر يعمل بدونه.'}</p>
        <p className="text-xs text-ink-400">لربط Claude Code، نفّذ الأمر التالي في الطرفية ثم افتح تطبيق قَصّة قبل استخدام الأدوات.</p>
        <input className="field w-full text-xs" dir="ltr" readOnly value={r.claudeCommand} aria-label="أمر ربط Claude Code" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(r.claudeCommand); setCopied(true); } catch { setError('حدّد الأمر وانسخه من الحقل.'); } }}>{copied ? 'نُسخ الأمر' : 'ربط Claude Code — نسخ الأمر'}</button>
      </section>
      <p className="text-xs text-ink-500" dir="auto">مجلد البيانات: {r.dataDir}</p>
    </>}{error && <p role="alert" className="text-cut-text">{error}</p>}
  </div></Modal>;
}
