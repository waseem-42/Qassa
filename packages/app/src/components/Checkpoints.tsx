import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore, type Checkpoint } from '../lib/store.ts';
import { Icon, Spinner } from './Brand.tsx';
import { Modal } from './Modal.tsx';

const savedDate = (date: string) => new Date(date).toLocaleString('ar-SA', { calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short' });

export function Checkpoints({ onClose }: { onClose(): void }) {
  const checkpoints = useStore((s) => s.checkpoints), rev = useStore((s) => s.rev);
  const connected = useStore((s) => s.connection === 'connected');
  const draft = useStore((s) => !!s.draftBase);
  const [label, setLabel] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [confirmation, setConfirmation] = useState<{ checkpoint: Checkpoint; expectedRev: number }>();
  const cancelRef = useRef<HTMLButtonElement>(null), labelRef = useRef<HTMLInputElement>(null), requests = useRef(0);
  const reload = async () => {
    const request = ++requests.current; setLoading(true); setError('');
    try { await useStore.getState().loadCheckpoints(); }
    catch (e) { if (request === requests.current) setError((e as Error).message); }
    finally { if (request === requests.current) setLoading(false); }
  };
  useEffect(() => { if (connected) void reload(); return () => { ++requests.current; }; }, [connected]);
  useEffect(() => { if (confirmation) cancelRef.current?.focus(); }, [confirmation]);
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!label.trim() || busy || !connected || draft) return;
    if (/[\u0000-\u001f\u007f]/.test(label)) { setError('اكتب اسمًا دون محارف تحكّم.'); return; }
    setBusy(true); setError(''); setStatus('');
    try {
      const checkpoint = await useStore.getState().saveCheckpoint(label);
      setLabel(''); setStatus(`حُفظت نقطة «${checkpoint.label}». يمكنك الرجوع إليها لاحقًا.`);
      requestAnimationFrame(() => labelRef.current?.focus());
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!confirmation || busy || !connected || draft || confirmation.expectedRev !== rev) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await useStore.getState().restoreCheckpoint(confirmation.checkpoint.id, confirmation.expectedRev);
      setConfirmation(undefined); setStatus('استُعيدت نقطة الحفظ. تجد التعديل السابق في نقطة الأمان الجديدة.');
      requestAnimationFrame(() => labelRef.current?.focus());
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const leaveConfirmation = () => { setConfirmation(undefined); setError(''); requestAnimationFrame(() => labelRef.current?.focus()); };
  return <Modal title="نقاط الحفظ" subtitle="احفظ مراحل قصتك، وارجع إلى التعديل الذي تختاره." initialFocus="#checkpoint-label" onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body checkpoints-body" aria-busy={busy}>
      {!connected && <p className="notice" role="status">انتظر عودة الاتصال لحفظ النقاط أو استعادتها.</p>}
      {draft && <p className="notice" role="status">أكمل التعديل الجاري قبل حفظ نقطة أو استعادتها.</p>}
      {confirmation ? <section className="checkpoint-confirm" aria-labelledby="checkpoint-restore-title"><span className="checkpoint-symbol"><Icon name="restore" size={24} /></span><h3 id="checkpoint-restore-title">استعادة «{confirmation.checkpoint.label}»؟</h3><p>سيعود المونتاج إلى هذه النقطة. قبل الاستعادة، يحفظ قَصّة نقطة أمان للتعديل الحالي تلقائيًا.</p><time dateTime={confirmation.checkpoint.createdAt}>{savedDate(confirmation.checkpoint.createdAt)}</time>{confirmation.expectedRev !== rev && <p className="notice" role="status">تغيّر المشروع منذ فتح التأكيد. ارجع إلى القائمة، وراجع التعديل الحالي قبل اختيار الاستعادة مجددًا.</p>}<div className="project-dialog-actions"><button ref={cancelRef} className="btn" disabled={busy} onClick={leaveConfirmation}>رجوع</button><button className="btn btn-primary" disabled={busy || !connected || draft || confirmation.expectedRev !== rev} onClick={restore}>{busy ? <Spinner size={16} /> : <Icon name="restore" />}استعادة نقطة الحفظ</button></div></section> : <>
        <form onSubmit={save} className="checkpoint-save"><label htmlFor="checkpoint-label">اسم نقطة الحفظ</label><div><input ref={labelRef} id="checkpoint-label" className="field" dir="auto" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلاً: القصّة قبل التلوين" required maxLength={120} disabled={busy} /><button className="btn btn-primary" disabled={!label.trim() || busy || !connected || draft}>{busy ? <Spinner size={16} /> : <Icon name="bookmark" />}حفظ نقطة</button></div></form>
        <div className="checkpoint-list-heading"><h3>المراحل المحفوظة <span className="count-badge">{checkpoints.length}</span></h3><button className="btn btn-ghost" disabled={loading || busy || !connected} onClick={reload}><Icon name="restore" />تحديث</button></div>
        {loading && <p className="checkpoint-loading" role="status"><Spinner size={18} />جارٍ تحميل نقاط الحفظ…</p>}
        {!loading && !checkpoints.length && !error && <div className="empty-state checkpoint-empty"><Icon name="bookmark" size={30} /><strong>احتفظ بمرحلة تستحق الرجوع</strong><p>سمّ أول نقطة حفظ قبل أن تجرّب مسارًا جديدًا في المونتاج.</p></div>}
        <div className="checkpoint-list">{[...checkpoints].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((p) => <article className="checkpoint-row" key={p.id}><span className="checkpoint-symbol"><Icon name={p.kind === 'before_restore' ? 'restore' : 'bookmark'} size={18} /></span><div><h4 dir="auto">{p.label}</h4><p><time dateTime={p.createdAt}>{savedDate(p.createdAt)}</time>{p.kind === 'before_restore' && <span className="checkpoint-auto">نقطة أمان تلقائية</span>}</p></div><button className="btn" aria-label={`استعادة نقطة ${p.label}`} disabled={busy || !connected || draft || rev < 0} onClick={() => { setError(''); setStatus(''); setConfirmation({ checkpoint: p, expectedRev: rev }); }}><Icon name="restore" />استعادة</button></article>)}</div>
      </>}
      {error && <p className="notice text-cut-text" role="alert">{error}</p>}{status && <p className="notice checkpoint-success" role="status">{status}</p>}
      <p className="checkpoint-scope">نقاط الحفظ تحفظ المونتاج وإعداداته داخل المشروع. ملفات الوسائط تبقى في مواقعها، ولا تُنسخ ضمن نقطة الحفظ.</p>
    </div>
  </Modal>;
}
