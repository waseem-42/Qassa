import { cancelUpload, useUploads } from '../lib/import.ts';
import { useStore } from '../lib/store.ts';

export function Uploads() {
  const name = useStore((s) => s.name);
  const items = useUploads((s) => s.items).filter((x) => x.project === name);
  if (!items.length) return null;
  return <div className="flex flex-col gap-2 p-3" aria-live="polite">{items.map((u) => (
    <div key={u.id} className="rounded-lg border border-ink-700 bg-ink-850 p-2 text-xs" data-upload={u.status}>
      <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate" dir="auto">{u.file.name}</span>
        {u.status !== 'processing' && <button className="btn btn-ghost h-6 text-xs" onClick={() => cancelUpload(u.id)}>{u.status === 'error' ? 'إغلاق' : 'إلغاء'}</button>}</div>
      <div className="my-1 text-ink-400">{u.status === 'error' ? u.error : u.status === 'queued' ? 'بانتظار الرفع' : u.status === 'processing' ? 'اكتمل الرفع · يفحص الملف…' : `يرفع ${Math.round(u.progress * 100)}٪`}</div>
      <progress className="h-1 w-full accent-accent" max={1} value={u.progress} aria-label={`رفع ${u.file.name}`} />
    </div>
  ))}</div>;
}
