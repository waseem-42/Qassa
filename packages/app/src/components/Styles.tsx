import { navigateGallery } from '../lib/keys.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { outputSize, textLayerHtml, Theme, type Grade, type Project, type StyleDef } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { TRANSITIONS } from './GraphicControls.tsx';
import { EditingStyles, FavoriteButton, SourceLibrary } from './EditingStyles.tsx';
import { useFavorites } from '../lib/favorites.ts';
import { RecentStyles, rememberStyle, StyleUsage } from './RecentStyles.tsx';
import { Modal } from './Modal.tsx';

// The styles window, in three places: apply now (looks and editing recipes, one click, undoable), discover ideas
// (the reference libraries sorted by what they are for, built with the assistant), and mine (favourites, recent,
// saved styles).

type Saved = StyleDef & { saved: true; createdAt: string; from?: string };

export function Styles() {
  const open = useStore((s) => s.stylesOpen);
  const target = useStore((s) => s.styleTarget);
  const project = useStore((s) => s.project);
  const name = useStore((s) => s.name);
  const { setStylesOpen, notify } = useStore.getState();
  const [lib, setLib] = useState<{ presets: StyleDef[]; saved: Saved[] }>({ presets: [], saved: [] });
  const [detail, setDetail] = useState<StyleDef>();
  const [frame, setFrame] = useState<string>();
  const [captions, setCaptions] = useState(true);
  const [transitions, setTransitions] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [busy, setBusy] = useState<string>();
  const [tab, setTab] = useState<'apply' | 'discover' | 'mine'>('apply');
  useEffect(() => {
    if (!open || !target) return;
    setTab(target.source === 'library' ? 'discover' : target.source === 'saved' ? 'mine' : 'apply');
    setLookQuery(target.source === 'library' ? '' : target.id);
    setDetail(undefined);
  }, [open, target]);
  const favIds = useFavorites((s) => s.ids);

  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Saved>();
  const [deleting, setDeleting] = useState(false);
  const [lookQuery, setLookQuery] = useState(''), [kind, setKind] = useState('');

  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const loadRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true); setLoadError('');
    try {
      const data = await api.get<{ presets: StyleDef[]; saved: Saved[] }>('/api/styles');
      if (request === loadRequest.current) setLib(data);
    } catch (e) { if (request === loadRequest.current) setLoadError((e as Error).message); }
    finally { if (request === loadRequest.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!open || !name) return;
    load();
    return () => { ++loadRequest.current; };
  }, [open, name, load]);
  const showLooks = !!detail || tab === 'apply' || tab === 'mine';
  useEffect(() => {
    if (!open || !name) return;
    if (!showLooks) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setFrame(undefined);
    // one real frame of the edit, plain (no grade, no overlays), to preview every look on
    const p = useStore.getState().project!;
    if (!p.clips.some((c) => c.trackId === 'V1' && c.mediaId)) return;
    const t = Math.min(useStore.getState().time, Math.max(0, p.clips.filter((c) => c.trackId === 'V1').reduce((m, c) => Math.max(m, c.start + (c.out - c.in) / c.speed), 0) - 0.1));
    fetch(`${projectPath(name)}/contact-sheet`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ times: [t], cols: 1, width: 640, composite: false }) })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no frame'))))
      .then((b) => { if (active) { objectUrl = URL.createObjectURL(b); setFrame(objectUrl); } })
      .catch(() => { if (active) setFrame(undefined); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, name, showLooks]);

  if (!open || !project || !name) return null;

  const apply = async (s: StyleDef) => {
    if (busy) return;
    setBusy(s.id);
    try {
      const r = await api.post(`${projectPath(name)}/apply-style`, { id: s.id, captions, transitions });
      if (useStore.getState().name === name && r.rev >= useStore.getState().rev) useStore.setState({ project: r.project, rev: r.rev, history: r.history });
      notify(`طُبّق ستايل «${s.name}» — تقدر تتراجع بـ Ctrl+Z`, 'info');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const save = async () => {
    if (!saveName.trim()) return notify('اكتب اسم للستايل');
    if (saving) return;
    setSaving(true);
    try {
      await api.post('/api/styles', { project: name, name: saveName });
      setSaveName('');
      notify('انحفظ الستايل — تقدر تطبّقه على أي مشروع', 'info');
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally { setSaving(false); }
  };
  const remove = async (s: Saved) => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/styles/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('تعذّر حذف الستايل. حاول مرة ثانية.');
      setDeleteTarget(undefined);
      await load();
      notify('تم حذف الستايل المحفوظ', 'info');
    } catch (e) { notify((e as Error).message); }
    finally { setDeleting(false); }
  };
  const refs = project.media.filter((m) => m.role === 'ref');
  const current = project.settings.theme;
  const isCurrent = (s: StyleDef) => (['accent', 'accent2', 'panel', 'text'] as const).every((k) => (s.theme[k] ?? Theme.parse({})[k]) === current[k]);
  // hearted looks / saved styles, most recent first (references are listed by the gallery itself)
  const looks: StyleDef[] = [...lib.presets, ...lib.saved];
  const favLooks = favIds.flatMap((id) => looks.filter((s) => s.id === id));
  const view = (s: StyleDef) => { setDetail(s); rememberStyle(s.id, lib.presets.some((p) => p.id === s.id) ? 'preset' : 'saved'); };
  const card = (s: StyleDef) => <StyleCard key={s.id} s={s} frame={frame} project={project} busy={!!busy} current={isCurrent(s)} used={project.stylesUsed.some((u) => u.id === s.id)} onApply={() => apply(s)} onView={() => view(s)} onDelete={lib.saved.some((x) => x.id === s.id) && !busy ? () => setDeleteTarget(s as Saved) : undefined} />;
  const matches = (s: StyleDef) => `${s.id} ${s.name} ${s.description} ${(s.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(lookQuery.trim().toLocaleLowerCase());
  // the built-in looks: one gallery, narrowed by what the video is (any of a look's tags)
  const kinds = [...new Set(lib.presets.flatMap((s) => s.tags ?? []))].filter((k) => lib.presets.filter((s) => s.tags?.includes(k)).length > 1);
  const shownLooks = lib.presets.filter((s) => matches(s) && (!kind || s.tags?.includes(kind)));
  const gallery = (list: StyleDef[]) => <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4" onKeyDown={(e) => { if (navigateGallery(e.currentTarget, e.target, e.key, '.style-look-open')) { e.preventDefault(); e.stopPropagation(); } }}>{list.map(card)}</div>;
  const lookControls = <div className="style-look-controls">
    <input className="field" aria-label="البحث في الهويات" placeholder="ابحث عن هوية… مثل شرح أو إعلان" value={lookQuery} onChange={(e) => setLookQuery(e.target.value)} />
    <label><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> تحديث تنسيق الكابشن</label>
    <label><input type="checkbox" checked={transitions} onChange={(e) => setTransitions(e.target.checked)} /> انتقالات على كل القصات</label>
  </div>;
  const status = loadError ? <div className="style-empty" role="alert"><h3>تعذّر تحميل الستايلات</h3><p>{loadError}</p><button className="btn" onClick={load}>إعادة المحاولة</button></div> : loading ? <p role="status" className="py-8 text-center text-sm text-ink-400">جارٍ تحميل الستايلات…</p> : null;

  return (
    <Modal title="مكتبة الستايلات" subtitle="اختر أسلوب المونتاج أو اضبط الهوية البصرية لمشروعك." full onClose={() => setStylesOpen(false)}>
    <div className="styles-window flex flex-col" dir="rtl">
      <nav className="styles-navigation" aria-label="أقسام الستايلات">
        {([['apply', 'طبّق على مشروعك', 'هويات ووصفات بضغطة'], ['discover', 'اكتشف أفكار', 'مراجع مرتبة حسب الاستخدام'], ['mine', 'مكتبتي', `${favIds.length} مفضلة · ${lib.saved.length} محفوظ`]] as const).map(([id, label, detail]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><b>{label}</b><span>{detail}</span></button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === 'discover' ? <SourceLibrary key={name} initialId={target?.source === 'library' ? target.id : undefined} /> : tab === 'apply' ? <>
          <div className="style-intro"><div><span className="style-eyebrow">يتطبق الحين، ويتراجع بـ Ctrl+Z</span><h2>نفس اللقطة. إحساس مختلف.</h2><p>الهوية تغيّر ألوان النصوص والرسوم والكابشن ودرجة الألوان، والمعاينة على لقطة من مشروعك. الوصفات تحت ترتب الحركة والكابشن والعناوين.</p></div></div>
          {lookControls}
          {status ?? <>
            <div className="style-kinds" role="group" aria-label="نوع الفيديو"><button aria-pressed={!kind} onClick={() => setKind('')}>الكل <span className="num">{lib.presets.length}</span></button>{kinds.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(kind === k ? '' : k)}>{k} <span className="num">{lib.presets.filter((s) => s.tags?.includes(k)).length}</span></button>)}</div>
            {gallery(shownLooks)}
            {!shownLooks.length && <div className="style-empty"><h3>لا توجد هوية بهذا البحث</h3><p>جرّب كلمة ثانية أو نوع آخر.</p><button className="btn" onClick={() => { setLookQuery(''); setKind(''); }}>عرض الكل</button></div>}
          </>}
          <section className="style-fav-section"><h3 className="style-section-title">وصفات مونتاج</h3><EditingStyles key={name} /></section>
        </> : <>
          <section className="style-fav-section">
            <h3 className="style-section-title">♥ المفضلة <span className="num">{favIds.length}</span></h3>
            {!!favLooks.length && <div className="mb-5">{gallery(favLooks)}</div>}
            <SourceLibrary key={`favorites-${name}`} favoritesOnly />
          </section>
          <section className="style-fav-section">
            <h3 className="style-section-title">آخر ما استخدمت</h3>
            <RecentStyles onUse={(id, source) => { if (source === 'library') useStore.getState().openStyle(id, source); else { const style = looks.find((s) => s.id === id); if (style) view(style); } }} />
          </section>
          <section className="style-fav-section">
            <h3 className="style-section-title">ستايلاتي المحفوظة <span className="num">{lib.saved.length}</span></h3>
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-800 bg-ink-900 p-3">
              <span className="text-sm text-ink-300">احفظ شكل هذا المشروع كستايل تستخدمه بعدين:</span>
              <input className="field h-8 w-56" aria-label="اسم الستايل المحفوظ" placeholder="اسم الستايل… مثلاً: قناتي" value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
              <button className="btn btn-primary h-8" disabled={saving || !saveName.trim()} onClick={save}>{saving ? 'جارٍ الحفظ…' : 'احفظ الهوية الحالية'}</button>
              <div className="flex-1" />
              {refs.length > 0 ? refs.map((m) => (
                <button key={m.id} className="btn h-8 text-xs" onClick={() => api.post(`${projectPath(name)}/style`, { refMediaId: m.id, strength: 0.6, apply: 'default' }).then(() => notify(`يبني ألوان من «${m.name}»…`, 'info')).catch((e) => notify(e.message))}>
                  ✦ ألوان من الرفرنس «{m.name}»
                </button>
              )) : <span className="text-xs text-ink-500">عندك مقطع بستايل تحبه؟ ارفعه كـ «رفرنس» من الوسائط وتقدر تاخذ ألوانه.</span>}
            </div>
            {status ?? (lib.saved.length ? gallery(lib.saved) : <p className="style-empty-line">اضبط ألوان المشروع والنصوص، ثم احفظ هويتك من الحقل بالأعلى — تقدر تطبّقها على أي مشروع.</p>)}
          </section>
        </>}
      </div>
    </div>
    {detail && <Modal wide title={detail.name} subtitle={lib.presets.some((s) => s.id === detail.id) ? 'ستايل مضمّن في قَصّة' : 'ستايل محفوظ محليًا'} onClose={() => setDetail(undefined)}><div className="modal-body style-look-detail"><StyleCard s={detail} frame={frame} project={project} busy={!!busy} current={isCurrent(detail)} used={project.stylesUsed.some((u) => u.id === detail.id)} onApply={() => apply(detail)} /><p className="text-xs text-ink-400">{lib.presets.some((s) => s.id === detail.id) ? 'المصدر: مكتبة قَصّة المحلية.' : 'المصدر: هوية محفوظة من مشروعك؛ حقوق الأصول تتبع مصادرها.'}</p><StyleUsage id={detail.id} /></div></Modal>}
    {deleteTarget && <Modal title={`حذف «${deleteTarget.name}»؟`} onClose={() => !deleting && setDeleteTarget(undefined)}><div className="p-5"><p className="mb-4 text-sm text-ink-400">سيُحذف من ستايلاتك المحفوظة. إعدادات المشاريع التي استخدمته ستبقى كما هي.</p><div className="flex gap-2"><button className="btn text-cut-text" disabled={deleting} onClick={() => remove(deleteTarget)}>{deleting ? 'جارٍ الحذف…' : 'حذف الستايل'}</button><button className="btn" disabled={deleting} onClick={() => setDeleteTarget(undefined)}>إلغاء</button></div></div></Modal>}
    </Modal>
  );
}

/** A CSS approximation of a grade, for the cards only (the render uses the real filters). */
function cssGrade(g?: Partial<Grade>): string {
  if (!g) return 'none';
  const f = [`brightness(${1 + (g.exposure ?? 0)})`, `contrast(${g.contrast ?? 1})`, `saturate(${g.saturation ?? 1})`];
  const t = g.temperature ?? 6500;
  if (t < 6400) f.push(`sepia(${Math.min(0.5, (6500 - t) / 3000)})`);
  if (t > 6600) f.push(`hue-rotate(${-Math.min(20, (t - 6500) / 100)}deg)`);
  return f.join(' ');
}

function StyleCard({ s, frame, project, busy, current, used, onApply, onView, onDelete }: {
  s: StyleDef; frame?: string; project: Project; busy: boolean; current: boolean; used: boolean; onApply: () => void; onView?: () => void; onDelete?: () => void;
}) {
  const theme = Theme.parse({ ...project.settings.theme, ...s.theme });
  const { width: W, height: H } = outputSize({ ...project.settings, resolution: 1080 });
  const preview = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(300);
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setCardW(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const k = cardW / W;
  const lower = { text: 'عنوان', textStyle: { preset: 'lower-third', x: 0.92, y: 0.22, align: 'start', size: 64 } } as const;
  const label = { text: 'Ctrl + D', textStyle: { preset: 'label', x: 0.06, y: 0.1, align: 'start', size: 44 } } as const;
  const caption = { text: 'هذا شكل الكابشن', textStyle: { preset: 'caption', size: 46, weight: 600, x: 0.5, y: 0.86, align: 'center', ...s.captions } } as const;
  return (
    <div className={`overflow-hidden rounded-xl border bg-ink-900 ${current ? 'border-accent' : 'border-ink-800'}`}>
      <div ref={preview} className="relative mx-auto overflow-hidden bg-ink-800" style={{ width: '100%', maxWidth: 340 * W / H, aspectRatio: `${W} / ${H}` }}>
        {frame ? <img src={frame} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ filter: cssGrade(s.grade) }} />
          : <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900" style={{ filter: cssGrade(s.grade) }} />}
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${k})` }}>
          {[lower, label, caption].map((c, i) => <div key={i} className="absolute inset-0" dangerouslySetInnerHTML={{ __html: textLayerHtml(c as never, H, theme) }} />)}
        </div>
        {onView && <button className="absolute inset-0" tabIndex={-1} aria-label={`تفاصيل ${s.name}`} onClick={onView} />}
        {used && <span className="style-used-badge">مستخدم في هذا المشروع</span>}
        {current && <span className="absolute left-2 top-2 rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-ink-950">نفس لوحة الألوان</span>}
      </div>
      <div className="p-3">
        <div className="mb-1 flex items-center gap-2">
          <FavoriteButton id={s.id} label={s.name} />
          <button className="style-look-open font-semibold text-start" onClick={onView} disabled={!onView}>{s.name}</button>
          <div className="flex gap-1">
            {[theme.accent, theme.accent2, theme.panel, theme.text].map((c, i) => <span key={i} className="h-3.5 w-3.5 rounded-full border border-ink-600" style={{ background: c }} />)}
          </div>
          <div className="flex-1" />
          {s.transition && <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">⧖ {TRANSITIONS[s.transition.kind]}</span>}
        </div>
        <p className="mb-2 min-h-10 text-xs leading-5 text-ink-400">{s.description}</p>
        {s.inspiredBy && <div className="mb-2 text-[10px] text-ink-500" dir="ltr">✧ {s.inspiredBy}</div>}
        <div className="flex gap-2">
          <button className="btn btn-primary h-8 flex-1 justify-center" disabled={busy} onClick={onApply}>{busy ? '…' : 'طبّق الهوية'}</button>
          {onDelete && <button className="btn btn-ghost h-8 text-xs text-cut-text" onClick={onDelete}>حذف</button>}
        </div>
      </div>
    </div>
  );
}
