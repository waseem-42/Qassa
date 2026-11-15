import { useRef, useState } from 'react';
import { freeTrackFor, fmtTime, type Media } from '@edit/shared';
import { Modal } from './Modal.tsx';
import { fileUrl } from '../lib/api.ts';
import { useSlowTime, useStore } from '../lib/store.ts';
import { sourceRangeOp } from '../lib/source-range.ts';

export function SourceRange({ media, projectId, onClose }: { media: Media; projectId: string; onClose(): void }) {
  const player = useRef<HTMLVideoElement>(null);
  const previewing = useRef(false);
  const tracks = useStore((s) => s.project!.tracks).filter((t) => t.id === 'V1' || t.kind === 'overlay');
  const [from, setFrom] = useState('0'), [to, setTo] = useState(String(media.duration));
  const [track, setTrack] = useState(media.role === 'broll' ? tracks.find((t) => t.kind === 'overlay')?.id ?? 'V1' : 'V1');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const connection = useStore((s) => s.connection);
  const time = useSlowTime();
  const start = from.trim() ? Number(from) : NaN, end = to.trim() ? Number(to) : NaN;
  let invalid = '';
  try { sourceRangeOp(media, start, end, track, time); } catch (e) { invalid = (e as Error).message; }
  const preview = async () => {
    if (!player.current || invalid) return;
    setError('');
    player.current.currentTime = start;
    previewing.current = true;
    try { await player.current.play(); } catch { setError('تعذّر تشغيل المعاينة. جرّب الملف الأصلي أو انتظر تجهيز البروكسي.'); }
  };
  const add = async () => {
    if (busy || invalid || useStore.getState().name !== projectId) return;
    setBusy(true); setError(''); player.current?.pause();
    try {
      const op = sourceRangeOp(media, start, end, track, time);
      const p = useStore.getState().project!;
      const plan = track === 'V1' ? undefined : freeTrackFor(p, media, time, time + (end - start), track);
      const ok = await useStore.getState().ops([...(plan?.ops ?? []), { ...op, clip: { ...op.clip, ...(plan ? { trackId: plan.track.id } : {}) } }]);
      if (ok) { useStore.getState().notify('أُضيف الجزء المحدد. يمكنك التراجع عن الإضافة.', 'info'); onClose(); }
      else setError('تعذّرت الإضافة. راجع الاتصال ثم حاول مرة أخرى.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title="اختيار جزء من المصدر" subtitle={media.name} wide onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body flex flex-col gap-4">
      <video ref={player} src={fileUrl(projectId, media.proxy ?? media.path)} controls playsInline preload="metadata" className="max-h-80 w-full rounded-lg bg-black" aria-label="معاينة الملف الأصلي"
        onError={() => setError('تعذّر عرض الملف في المتصفح. قد تحتاج إلى إعادة التحليل لتجهيز بروكسي متوافق.')}
        onTimeUpdate={() => { const v = player.current; if (v && previewing.current && v.currentTime >= end) { v.pause(); v.currentTime = end; previewing.current = false; } }} />
      <p className="text-xs text-ink-400">حدّد الزمن بالثواني من الملف الأصلي. الإضافة تنشئ لقطة جديدة وتحافظ على اللقطات الموجودة.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-2 text-sm">البداية بالثواني<input className="field w-full" type="number" min={0} max={media.duration} step="0.01" aria-label="البداية بالثواني" value={from} disabled={busy} onChange={(e) => setFrom(e.target.value)} /><button className="btn justify-center text-xs" disabled={busy} onClick={() => setFrom(String(Math.round((player.current?.currentTime ?? 0) * 1000) / 1000))}>البداية من موضع المعاينة</button></label>
        <label className="flex min-w-0 flex-col gap-2 text-sm">النهاية بالثواني<input className="field w-full" type="number" min={0} max={media.duration} step="0.01" aria-label="النهاية بالثواني" value={to} disabled={busy} onChange={(e) => setTo(e.target.value)} /><button className="btn justify-center text-xs" disabled={busy} onClick={() => setTo(String(Math.min(media.duration, Math.round((player.current?.currentTime ?? 0) * 1000) / 1000)))}>النهاية من موضع المعاينة</button></label>
      </div>
      <div className="flex flex-wrap items-center gap-3"><button className="btn" disabled={busy || !!invalid} onClick={preview}>شغّل الجزء المحدد</button><span className="num text-sm text-ink-400">{invalid ? '—' : fmtTime(end - start, 2)}</span><button className="btn btn-ghost" disabled={busy} onClick={() => { setFrom('0'); setTo(String(media.duration)); }}>الملف كاملًا</button></div>
      <label className="flex flex-col gap-2 text-sm">مكان الإضافة<select className="field" value={track} disabled={busy} onChange={(e) => setTrack(e.target.value)}>{tracks.map((t) => <option key={t.id} value={t.id}>{t.id === 'V1' ? 'نهاية الأساسي' : `${t.name} عند المؤشر`}</option>)}</select></label>
      {track !== 'V1' && <p className="text-xs text-ink-400">موضع الإضافة في المشروع: <span className="num">{fmtTime(time, 2)}</span></p>}
      {(invalid || error) && <p role="alert" className="text-sm text-cut-text">{error || invalid}</p>}
      <button className="btn btn-primary justify-center" disabled={busy || !!invalid || connection !== 'connected'} onClick={add}>{busy ? 'جارٍ الإضافة…' : 'أضف الجزء المحدد'}</button>
    </div>
  </Modal>;
}
