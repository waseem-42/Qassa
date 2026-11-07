import { useEffect, useState } from 'react';
import type { StyleUse } from '@edit/shared';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.ts';
import { Icon } from './Brand.tsx';

type Recent = Pick<StyleUse, 'id' | 'source' | 'at' | 'by'> & { project: string; name: string; available: boolean };

export function rememberStyle(id: string, source: StyleUse['source']) {
  return api.post('/api/style-library/recent', { id, source, project: useStore.getState().name ?? '', by: 'user' }).catch((e) => useStore.getState().notify(`تعذّر حفظ الأخيرة: ${e.message}`));
}

function dayGroup(at: string) {
  const now = new Date(), then = new Date(at);
  const days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) / 86400000);
  return days <= 0 ? 'اليوم' : days === 1 ? 'أمس' : days < 7 ? 'هذا الأسبوع' : 'أقدم';
}

export function RecentStyles({ onUse }: { onUse(id: string, source: StyleUse['source']): void }) {
  const [rows, setRows] = useState<Recent[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = () => { setLoading(true); setError(''); api.get<Recent[]>('/api/style-library/recent').then(setRows).catch((e) => setError(e.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  const remove = async (row?: Recent) => {
    try { await api.delete(`/api/style-library/recent${row ? `/${encodeURIComponent(row.id)}?project=${encodeURIComponent(row.project)}` : ''}`); load(); }
    catch (e) { setError((e as Error).message); }
  };
  return <section className="style-recent">
    <div className="style-recent-heading"><div><span className="eyebrow">بين كل مشاريعك</span><h2>ارجع لآخر أسلوب ألهمك.</h2><p>الستايلات التي طبّقتها أو فتحت تفاصيلها، الأحدث أولًا.</p></div>{!!rows.length && <button className="btn btn-ghost" onClick={() => remove()}>مسح السجل</button>}</div>
    {error && <p className="text-cut-text" role="alert">{error}<button className="btn" onClick={load}>إعادة المحاولة</button></p>}
    {loading && <p role="status">جارٍ تحميل الأخيرة…</p>}
    {!loading && !rows.length && !error && <div className="style-empty"><Icon name="clock" size={28} /><h3>أول أسلوب ينتظرك</h3><p>افتح تفاصيل ستايل أو استخدمه في مشروع، وسيظهر هنا مع اسم المشروع لتعود إليه بسهولة.</p></div>}
    {['اليوم', 'أمس', 'هذا الأسبوع', 'أقدم'].map((group) => {
      const list = rows.filter((r) => dayGroup(r.at) === group);
      return !!list.length && <section key={group}><h3 className="style-section-title">{group}</h3><div className="style-recent-list">{list.map((row) => <article key={`${row.source}:${row.id}:${row.project}`} className="style-recent-row"><div><strong dir="auto">{row.name}</strong><p>{row.project || 'خارج مشروع'} · {({ preset: 'جاهز', saved: 'محفوظ', library: 'مرجع مكتبة' })[row.source]} · {new Date(row.at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</p>{!row.available && <small>لم يعد هذا الستايل متاحًا في المكتبة</small>}</div><button className="btn" disabled={!row.available} onClick={() => onUse(row.id, row.source)}>استخدم مجددًا</button><button className="icon-button" aria-label={`إزالة ${row.name} من الأخيرة`} onClick={() => remove(row)}><Icon name="close" size={16} /></button></article>)}</div></section>;
    })}
  </section>;
}

export function StyleUsage({ id }: { id: string }) {
  const at = useStore((s) => s.project?.stylesUsed.find((u) => u.id === id)?.at);
  const [rows, setRows] = useState<(StyleUse & { project: string; name: string })[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let active = true; setError('');
    api.get<(StyleUse & { project: string; name: string })[]>(`/api/style-library/${encodeURIComponent(id)}/usage`).then((data) => { if (active) setRows(data); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, at]);
  return <div className="style-usage"><b>استُخدم في المشاريع</b>{rows.map((r) => <p key={r.project}><strong dir="auto">{r.name}</strong><span>{r.what}</span></p>)}{!rows.length && !error && <p>لم يُستخدم في مشروع بعد.</p>}{error && <p role="alert">تعذّر تحميل سجل المشاريع: {error}</p>}</div>;
}
