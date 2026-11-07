import { useEffect, useRef, useState } from 'react';
import { THEME_FONTS, TIERS, type BrandKit, type Project, type Theme } from '@edit/shared';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.ts';
import { Modal } from './Modal.tsx';
import { Icon, Spinner } from './Brand.tsx';

const fields = { accent: 'المميّز', accent2: 'الثاني', panel: 'البطاقات', text: 'الكتابة' } as const;
const assetUrl = (kit: BrandKit, path: string) => `/api/brands/${kit.id}/${path.split('/').map(encodeURIComponent).join('/')}`;

function KitMark({ kit }: { kit: BrandKit }) {
  return <><div className="brand-swatches">{Object.entries(fields).map(([key, label]) => <span key={key} title={`${label}: ${kit.theme[key as keyof typeof fields] ?? 'غير محدد'}`} style={{ background: kit.theme[key as keyof typeof fields] }} />)}</div>{kit.logos[0] && <img className="brand-logo" src={assetUrl(kit, kit.logos[0])} alt={`شعار ${kit.name}`} />}</>;
}

export function BrandKits({ project }: { project: Project }) {
  const name = useStore((s) => s.name)!;
  const [kits, setKits] = useState<BrandKit[]>([]), [review, setReview] = useState<BrandKit>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = async () => setKits(await api.get<BrandKit[]>('/api/brands'));
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  const upload = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true); setError('');
    try { const kit = await api.upload<BrandKit>('/api/brands', [file]); await load(); setReview(kit); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const applied = kits.find((k) => k.id === project.settings.brand);
  return <section className="brand-kits" aria-label="ملفات الهوية">
    {applied && <div className="brand-applied"><span className="eyebrow">الهوية المطبّقة</span><strong>{applied.name}</strong><KitMark kit={applied} /></div>}
    <div className="brand-drop" data-drag={drag || undefined} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); upload(e.dataTransfer.files[0]); }}>
      <Icon name="upload" size={22} /><p>اسحب ملف الهوية هنا</p><small>Markdown · JSON · CSS · HTML · ZIP · صورة · PDF<br />حتى 32 MB — تُراجع القيم قبل تطبيقها</small><button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Spinner size={16} /> : <Icon name="plus" />}ارفع ملف هوية</button>
      <input ref={input} type="file" hidden accept=".md,.json,.css,.html,.htm,.zip,.svg,.png,.jpg,.jpeg,.webp,.pdf" onChange={(e) => upload(e.target.files?.[0])} />
    </div>
    {error && <p className="text-xs text-cut-text" role="alert">{error}</p>}
    <div className="brand-saved"><span className="eyebrow">الهويات المحفوظة · {kits.length}</span>{kits.map((kit) => <button className="brand-kit" key={kit.id} aria-pressed={kit.id === project.settings.brand} onClick={() => setReview(kit)}><strong>{kit.name}</strong><KitMark kit={kit} /></button>)}{!kits.length && <p className="text-xs text-ink-400">الهوية التي ترفعها تبقى متاحة لكل مشاريعك.</p>}</div>
    {review && <BrandReview key={review.id} kit={review} projectName={name} onClose={() => setReview(undefined)} onSaved={async () => { await load(); setReview(undefined); }} />}
  </section>;
}

function BrandReview({ kit, projectName, onClose, onSaved }: { kit: BrandKit; projectName: string; onClose(): void; onSaved(): Promise<void> }) {
  const [draft, setDraft] = useState(kit), [target, setTarget] = useState<keyof typeof fields>('accent');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [cost, setCost] = useState<number>();
  const [jobId, setJobId] = useState<string>();
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[href^="/api/graphics/fonts.css"]');
    if (link) link.href = `/api/graphics/fonts.css?v=${Date.now()}`;
  }, [kit.id]);
  const patch = (theme: Partial<Theme>) => setDraft((d) => ({ ...d, theme: { ...d.theme, ...theme } }));
  useEffect(() => {
    if (!jobId) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await api.get(`/api/jobs/${jobId}`);
        if (!active) return;
        if (job.status === 'done') {
          setDraft(job.result.brand); setBusy(false); setJobId(undefined);
          const log = await api.get(`/api/projects/${encodeURIComponent(projectName)}/agent/log`);
          if (active) setCost(log.tasks[0]?.cost);
        } else if (['error', 'cancelled'].includes(job.status)) { setBusy(false); setJobId(undefined); setError(job.error ?? 'توقفت قراءة الملف'); }
        else timer = setTimeout(poll, 800);
      } catch (e) { if (active) { setBusy(false); setJobId(undefined); setError((e as Error).message); } }
    };
    poll(); return () => { active = false; clearTimeout(timer); };
  }, [jobId, projectName]);
  const extract = async () => {
    setBusy(true); setError('');
    try { const { job } = await api.post(`/api/brands/${kit.id}/extract`, { project: projectName }); setJobId(job.id); }
    catch (e) { setBusy(false); setError((e as Error).message); }
  };
  const apply = async () => {
    if (busy || useStore.getState().name !== projectName) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/api/brands/${kit.id}`, { name: draft.name, theme: draft.theme });
      const fontLink = document.querySelector<HTMLLinkElement>('link[href^="/api/graphics/fonts.css"]');
      if (fontLink) fontLink.href = `/api/graphics/fonts.css?v=${Date.now()}`;
      if (!await useStore.getState().ops([{ op: 'set_settings', patch: { brand: kit.id, theme: draft.theme } }])) throw new Error('تعذّر تطبيق الهوية');
      await onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const fallback = Object.keys(kit.theme).length < 3 || /\.(pdf|png|jpe?g|webp)$/i.test(kit.source);
  return <Modal title="راجع الهوية" subtitle={`${kit.source} — اختر خانة ثم اضغط لونًا من اللوحة لتبديله.`} onClose={() => { if (!busy) onClose(); }} wide>
    <div className="modal-body brand-review" aria-busy={busy}>
      <label>اسم الهوية<input className="field" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <div className="brand-mapping">{Object.entries(fields).map(([key, label]) => <button key={key} className="brand-field" aria-pressed={target === key} onClick={() => setTarget(key as keyof typeof fields)}><span style={{ background: draft.theme[key as keyof typeof fields] }} />{label}<bdi>{draft.theme[key as keyof typeof fields] ?? 'لون المشروع الحالي'}</bdi></button>)}</div>
      <div className="brand-palette" aria-label="لوحة الألوان">{draft.palette.map((p, i) => <button key={i} title={`${p.name}: ${p.color} ← ${fields[target]}`} aria-label={`استخدم ${p.color} في ${fields[target]}`} style={{ background: p.color }} onClick={() => patch({ [target]: p.color })} />)}</div>
      <label>الخط<select className="field" value={draft.theme.font ?? ''} onChange={(e) => patch({ font: e.target.value })}><option value="" disabled>خط المشروع الحالي</option>{[...new Set([...THEME_FONTS.map((f) => f.family), ...draft.fonts.map((f) => f.family), ...(draft.theme.font ? [draft.theme.font] : [])])].map((family) => <option key={family}>{family}</option>)}</select></label>
      {draft.theme.font && !THEME_FONTS.some((f) => f.family === draft.theme.font) && !draft.fonts.some((f) => f.family === draft.theme.font) && <p className="text-xs text-cut-text">الخط مذكور في الهوية لكن ملفه غير مرفق؛ سيُستخدم خط بديل. اختر خطًا متاحًا أو ارفع ZIP يحتوي ملف الخط.</p>}
      <p className="brand-font-sample" style={{ fontFamily: draft.theme.font }}>كل قصة تبدأ بلقطة — حروف عربية ١٢٣</p>
      <label>الاتجاه<select className="field" value={draft.theme.direction ?? 'auto'} onChange={(e) => patch({ direction: e.target.value as Theme['direction'] })}><option value="auto">تلقائي</option><option value="rtl">من اليمين</option><option value="ltr">من اليسار</option></select></label>
      <div className="brand-logos">{draft.logos.map((path) => <img key={path} src={assetUrl(draft, path)} alt="شعار الهوية" />)}</div>
      {draft.notes && <p className="text-sm text-ink-300 whitespace-pre-wrap">{draft.notes}</p>}
      {!Object.keys(draft.theme).length && <p className="notice">لم نجد قيمًا واضحة محليًا. يمكنك قراءة الملف بالذكاء، أو اختيار الألوان والخط قبل التطبيق.</p>}
      {fallback && <button className="btn" disabled={busy} onClick={extract}>اقرأ الهوية بالذكاء · <bdi dir="ltr">${TIERS.quick.estimate[0]}–${TIERS.quick.estimate[1]}</bdi> · حد <bdi dir="ltr">${TIERS.quick.budget}</bdi></button>}
      {cost !== undefined && <p className="text-xs text-ink-400">تكلفة القراءة: ${cost.toFixed(3)}</p>}
      {error && <p className="text-cut-text" role="alert">{error}</p>}
      <div className="project-dialog-actions">{jobId && <button className="btn" onClick={() => api.post(`/api/jobs/${jobId}/cancel`).catch((e) => setError(e.message))}>إيقاف القراءة</button>}<button className="btn" disabled={busy} onClick={onClose}>إلغاء</button><button className="btn btn-primary" disabled={busy || !draft.name.trim()} onClick={apply}>{busy ? <Spinner size={16} /> : null}طبّق على المشروع</button></div>
    </div>
  </Modal>;
}
