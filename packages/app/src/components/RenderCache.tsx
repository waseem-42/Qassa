import { useEffect, useState } from 'react';
import { api, projectPath } from '../lib/api.ts';
import { Spinner } from './Brand.tsx';

interface CacheInfo { bytes: number; removedBytes: number; remaining: number; busy: boolean }
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function RenderCache({ name, active }: { name: string; active: boolean }) {
  const [info, setInfo] = useState<CacheInfo>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.get<CacheInfo>(`${projectPath(name)}/cache`).then((result) => { if (!cancelled) setInfo(result); }).catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [name, active]);
  const clean = async () => {
    setBusy(true); setError('');
    try {
      const result = await api.post<CacheInfo>(`${projectPath(name)}/cache/cleanup`);
      setInfo({ ...result, bytes: result.remaining });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="export-preflight" aria-label="الملفات المؤقتة">
    <div className="export-readiness-heading flex-wrap gap-2"><h3>الملفات المؤقتة {info && <span className="num text-ink-400" dir="ltr">{size(info.bytes)}</span>}</h3>
      <button className="btn btn-ghost" disabled={busy || active || info?.busy || !info} onClick={clean}>{busy && <Spinner size={16} />}تنظيف الملفات المؤقتة</button></div>
    <p className="text-xs text-ink-400">تُنظَّف ملفات التصدير القديمة تلقائيًا. يمكن إعادة إنشائها عند الحاجة.</p>
    {(active || info?.busy) && <p className="text-xs text-ink-400" role="status">يتاح التنظيف بعد اكتمال مهام المشروع.</p>}
    {error && <p className="text-cut-text" role="alert">{error}</p>}
  </section>;
}
