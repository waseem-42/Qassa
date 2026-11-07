import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CAPTION_TRACK, EXPORT_PRESETS, ExportSettings, fmtTime, isAudioFormat, markedRange, projectDuration, outputSize, type ReviewFinding, type Settings } from '@edit/shared';
type Aspect = Settings['aspect'];
import { useStore, type Job, type RenderVersion } from '../lib/store.ts';
import { api, ApiError, projectPath } from '../lib/api.ts';
import { canSubmitExport, parseTimecode, type ExportPreflight, type ExportQuality } from '../lib/export.ts';
import { Icon, Spinner } from './Brand.tsx';
import { Modal } from './Modal.tsx';
import { RenderCache } from './RenderCache.tsx';

const NAME_SUFFIX: Record<string, string> = { youtube: 'يوتيوب', shorts: 'شورتس', instagram: 'إنستقرام', '4k': '4K', review: 'مراجعة', audio: 'صوت' };
interface Saved { preset: string; quality: ExportQuality; settings: Partial<ExportSettings> }
const savedKey = (name: string) => `qassa.export.${name}`;
function loadSaved(name: string): Saved | undefined {
  try { const raw = localStorage.getItem(savedKey(name)); return raw ? JSON.parse(raw) as Saved : undefined; } catch { return undefined; }
}

export function ExportDialog({ initial, onClose }: { initial: 'export' | 'jobs'; onClose(): void }) {
  const { name, project, rev, jobs, connection, lastRender, draftBase, time } = useStore(useShallow(({ name, project, rev, jobs, connection, lastRender, draftBase, time }) => ({ name, project, rev, jobs, connection, lastRender, draftBase, time })));
  const saved = useRef(name ? loadSaved(name) : undefined).current;
  const [preset, setPreset] = useState(saved?.preset ?? 'project');
  const [quality, setQuality] = useState<ExportQuality>(saved?.quality ?? 'final');
  const [settings, setSettings] = useState<Partial<ExportSettings>>(() => { const { fileName: _, range: __, ...rest } = saved?.settings ?? {}; return rest; });
  const [fileName, setFileName] = useState(project?.name ?? ''), [nameTouched, setNameTouched] = useState(false);
  const total = project ? projectDuration(project) : 0;
  const marks = useRef(project ? markedRange(project) : undefined).current;
  const [part, setPart] = useState<'all' | 'range'>(marks ? 'range' : 'all'), [from, setFrom] = useState(fmtTime(marks?.[0] ?? 0, 3)), [to, setTo] = useState(fmtTime(marks?.[1] ?? total, 3));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [check, setCheck] = useState<ExportPreflight>(), [checking, setChecking] = useState(false), [checkError, setCheckError] = useState('');
  const [queued, setQueued] = useState<RenderVersion>();
  const reviewAspect = settings.aspect ?? project?.settings.aspect;
  const requests = useRef(0);
  const loadPreflight = async () => {
    if (!name || connection !== 'connected') return;
    const request = ++requests.current; setChecking(true); setCheckError(''); setCheck(undefined);
    try {
      const result = await api.get<ExportPreflight>(`${projectPath(name)}/render/preflight?quality=${quality}${reviewAspect ? `&aspect=${reviewAspect}` : ''}`);
      if (request === requests.current) setCheck(result);
    } catch (e) { if (request === requests.current) setCheckError((e as Error).message); }
    finally { if (request === requests.current) setChecking(false); }
  };
  useEffect(() => {
    if (initial === 'export' && rev >= 0 && connection === 'connected') void loadPreflight();
    else { setCheck(undefined); setChecking(false); }
    return () => { ++requests.current; };
  }, [name, initial, rev, quality, connection, reviewAspect]);
  if (!name || !project) return null;

  const s = ExportSettings.parse(settings);
  const audio = isAudioFormat(s.format);
  const aspect: Aspect = s.aspect ?? project.settings.aspect;
  const resolution = s.resolution ?? project.settings.resolution;
  const size = outputSize({ aspect, resolution: quality === 'preview' ? Math.min(720, resolution) : resolution });
  const hasCaptions = project.clips.some((c) => c.trackId === CAPTION_TRACK);
  const r0 = parseTimecode(from), r1 = parseTimecode(to);
  const rangeError = part === 'range' && (r0 === undefined || r1 === undefined || r1 - r0 < 0.1 || r0 >= total) ? 'حدّد بداية قبل النهاية داخل مدة المونتاج (مثل 00:12.5).' : '';
  const length = part === 'range' && !rangeError ? Math.min(r1!, total) - r0! : total;
  const render = Object.values(jobs).find((j) => j.kind === 'render' && ['running', 'queued'].includes(j.status));
  const recent = Object.values(jobs).filter((j) => initial === 'jobs' || j.kind === 'render').sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  const stale = !!check && check.rev !== rev;
  const ext = s.format;

  const set = (patch: Partial<ExportSettings>) => { setSettings((x) => ({ ...x, ...patch })); setPreset('custom'); setError(''); };
  const pick = (id: string) => {
    const p = EXPORT_PRESETS.find((x) => x.id === id)!;
    setPreset(id); setQuality(p.quality); setSettings({ ...p.settings }); setError('');
    if (!nameTouched) setFileName(NAME_SUFFIX[id] ? `${project.name} - ${NAME_SUFFIX[id]}` : project.name);
  };
  const start = async () => {
    if (!canSubmitExport(check, rev, quality) || busy || rangeError || draftBase || connection !== 'connected') return;
    setBusy(true); setError(''); setQueued(undefined);
    const body: ExportSettings = { ...s, fileName: fileName.trim() || project.name, ...(part === 'range' ? { range: [r0!, r1!] as [number, number] } : {}) };
    try {
      setQueued(await useStore.getState().startRender(quality, check!.rev, body));
      try { localStorage.setItem(savedKey(name), JSON.stringify({ preset, quality, settings } satisfies Saved)); } catch { /* remembering is a convenience */ }
    } catch (e) {
      if (e instanceof ApiError && e.body?.code === 'stale_revision') { setError('تغيّر المشروع بعد الفحص. حدّث بيانات المشروع ثم راجع الجاهزية مجددًا.'); void loadPreflight(); }
      else if (e instanceof ApiError && e.body?.code === 'export_not_ready' && e.body.preflight) { setCheck(e.body.preflight as ExportPreflight); setError('تغيّرت جاهزية المشروع. راجع العناصر المطلوبة أدناه.'); }
      else if (e instanceof ApiError && e.body?.code === 'empty_range') setError('الجزء المحدد فاضي. غيّر البداية أو النهاية.');
      else setError((e as Error).message);
    } finally { setBusy(false); }
  };
  const cancel = async (id: string) => { try { await api.post(`/api/jobs/${encodeURIComponent(id)}/cancel`); } catch (e) { setError((e as Error).message); } };
  const reveal = async (output: string) => { try { await api.post(`${projectPath(name)}/renders/reveal`, { output }); } catch (e) { setError((e as Error).message); } };
  const refreshProject = async () => { setBusy(true); try { await useStore.getState().open(name); } finally { setBusy(false); } };
  const labels = { queued: 'في الانتظار', running: 'قيد التنفيذ', done: 'اكتملت', error: 'تعذرت', cancelled: 'أُلغيت' };
  const fileOf = (output: string) => output.split('/').pop();

  return <Modal title={initial === 'export' ? 'جاهز لمشاركة قصتك؟' : 'نشاط المشروع'} subtitle={initial === 'export' ? 'اختر وجهة الفيديو، عدّل ما تحتاج، وصدّر.' : 'تابع التحليل والتصدير من مكان واحد.'} onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body">
      {initial === 'export' && <>
        <div className="export-presets" role="radiogroup" aria-label="وجهة التصدير">
          {EXPORT_PRESETS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className="choice-card" data-selected={preset === p.id} disabled={busy} onClick={() => pick(p.id)}><div><strong>{p.name}</strong><small>{p.id === 'project' ? `${project.settings.aspect} · ${project.settings.resolution}p` : p.hint}</small></div></button>)}
        </div>

        <div className="export-fields">
          <label className="export-field export-field-wide"><span>اسم الملف</span>
            <div className="export-name"><input className="field" value={fileName} maxLength={100} disabled={busy} onChange={(e) => { setFileName(e.target.value); setNameTouched(true); }} /><span className="num" dir="ltr">.{ext}</span></div>
          </label>
          <label className="export-field"><span>الصيغة</span>
            <select className="field" value={s.format} disabled={busy} onChange={(e) => set({ format: e.target.value as ExportSettings['format'] })}>
              <option value="mp4">MP4 فيديو</option><option value="mov">MOV فيديو</option><option value="mp3">MP3 صوت فقط</option><option value="wav">WAV صوت فقط</option>
            </select>
          </label>
          {!audio && <>
            <label className="export-field"><span>المقاس</span>
              <select className="field" value={aspect} disabled={busy} onChange={(e) => set({ aspect: e.target.value as Aspect })}>
                {(['16:9', '9:16', '1:1', '4:5'] as const).map((a) => <option key={a} value={a}>{a}{a === project.settings.aspect ? ' (المشروع)' : ''}</option>)}
              </select>
            </label>
            <label className="export-field"><span>الدقة</span>
              <select className="field" value={resolution} disabled={busy} onChange={(e) => set({ resolution: Number(e.target.value) })}>
                {[...new Set([720, 1080, 1440, 2160, project.settings.resolution])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r === 2160 ? '4K · 2160p' : r === 1440 ? '2K · 1440p' : `${r}p`}</option>)}
              </select>
            </label>
            <label className="export-field"><span>الفريمات</span>
              <select className="field" value={s.fps ?? project.settings.fps} disabled={busy} onChange={(e) => set({ fps: Number(e.target.value) })}>
                {[...new Set([24, 25, 30, 50, 60, project.settings.fps])].sort((a, b) => a - b).map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </label>
            <label className="export-field"><span>الجودة</span>
              <select className="field" value={s.level} disabled={busy} onChange={(e) => set({ level: e.target.value as ExportSettings['level'] })}>
                <option value="small">حجم أصغر</option><option value="balanced">متوازنة (مقترح)</option><option value="high">أعلى جودة</option>
              </select>
            </label>
            <label className="export-field"><span>الترميز</span>
              <select className="field" value={s.codec} disabled={busy} onChange={(e) => set({ codec: e.target.value as ExportSettings['codec'] })}>
                <option value="h264">H.264 — يشتغل في كل مكان</option><option value="h265">H.265 — حجم أصغر</option>
              </select>
            </label>
            {hasCaptions && <label className="export-field"><span>الكابشن</span>
              <select className="field" value={s.captions} disabled={busy} onChange={(e) => set({ captions: e.target.value as ExportSettings['captions'] })}>
                <option value="burn">داخل الفيديو</option><option value="srt">ملف SRT منفصل</option><option value="both">الاثنين</option><option value="none">بدون</option>
              </select>
            </label>}
          </>}
          <fieldset className="export-field export-field-wide"><legend>الجزء المُصدَّر</legend>
            {marks && part === 'range' && r0 === marks[0] && r1 === marks[1] && <p className="mb-2 text-xs text-accent">من العلامات I/O</p>}
            <div className="export-part">
              <label><input type="radio" name="export-part" checked={part === 'all'} disabled={busy} onChange={() => setPart('all')} />المونتاج كامل</label>
              <label><input type="radio" name="export-part" checked={part === 'range'} disabled={busy} onChange={() => setPart('range')} />جزء منه</label>
            </div>
            {part === 'range' && <div className="export-range">
              <label><span>من</span><input className="field num" dir="ltr" value={from} disabled={busy} onChange={(e) => setFrom(e.target.value)} /><button type="button" className="btn btn-ghost" onClick={() => setFrom(fmtTime(Math.min(time, total), 1))}>المؤشر</button></label>
              <label><span>إلى</span><input className="field num" dir="ltr" value={to} disabled={busy} onChange={(e) => setTo(e.target.value)} /><button type="button" className="btn btn-ghost" onClick={() => setTo(fmtTime(Math.min(time, total), 1))}>المؤشر</button></label>
              {rangeError && <p className="text-cut-text" role="alert">{rangeError}</p>}
            </div>}
          </fieldset>
        </div>
        {!audio && aspect !== project.settings.aspect && <p className="notice">المقاس غير مقاس المشروع: اللقطات تُقص من المنتصف لتملأ الإطار، والرسوم المصممة لمقاس واحد قد لا تناسبه. صدّر «مراجعة سريعة» أولًا وشيّك عليها.</p>}

        <dl className="export-specs">
          <div><dt>{audio ? 'الصوت' : 'الأبعاد'}</dt><dd className="num">{audio ? (s.format === 'wav' ? 'WAV 48kHz' : 'MP3 320k') : `${size.width} × ${size.height}`}</dd></div>
          <div><dt>{audio ? 'الوضع' : 'الإطارات'}</dt><dd className="num">{audio ? 'صوت فقط' : `${s.fps ?? project.settings.fps} fps`}</dd></div>
          <div><dt>المدة</dt><dd className="num">{fmtTime(Math.max(0, length), 1)}</dd></div>
        </dl>

        <section className="export-preflight" aria-labelledby="export-preflight-title" aria-busy={checking}><div className="export-readiness-heading"><h3 id="export-preflight-title">جاهزية التصدير</h3><button className="btn btn-ghost" disabled={checking || busy || connection !== 'connected'} onClick={loadPreflight}><Icon name="restore" />إعادة الفحص</button></div>
          {checking ? <p className="export-check-status" role="status"><Spinner size={18} />جارٍ فحص الملفات والمونتاج…</p> : checkError ? <p className="text-cut-text" role="alert">تعذّر فحص الجاهزية: {checkError}</p> : check ? <>
            <p className={`export-check-status ${check.ready && !stale ? 'text-note' : 'text-cut-text'}`} role="status"><Icon name={check.ready && !stale ? 'film' : 'comment'} size={18} />{stale ? 'تغيّر المشروع منذ الفحص' : check.ready ? 'جاهز لبدء التصدير' : 'أكمل العناصر التالية قبل التصدير'}</p>
            <p className="export-checked-version">النسخة التي فُحصت <Version version={check} /></p>
            {stale && <div className="notice"><p>حمّل آخر تعديل للمشروع، ثم راجع الفحص قبل التصدير.</p><button className="btn mt-2" disabled={busy || connection !== 'connected'} onClick={refreshProject}>تحديث بيانات المشروع</button></div>}
            {!!check.blockers.length && <div className="export-issues export-blockers"><h4>مطلوب قبل التصدير</h4><ul>{check.blockers.map((issue, i) => <li key={`${issue.code}-${i}`}><p>{issue.message}</p>{issue.path && <code dir="ltr">{issue.path}</code>}</li>)}</ul></div>}
            {!!check.warnings.length && <details className="export-issues export-warnings"><summary>ملاحظات للمراجعة ({check.warnings.length}) — يمكنك التصدير</summary><ul>{check.warnings.map((issue, i) => <li key={`${issue.code}-${i}`}><p>{issue.message}</p>{issue.path && <code dir="ltr">{issue.path}</code>}</li>)}</ul></details>}
            {!!check.review?.length && <ReviewList findings={check.review} />}
          </> : <p className="text-ink-400">سيُفحص المشروع قبل بدء التصدير.</p>}
        </section>
        <RenderCache name={name} active={Object.values(jobs).some((j) => ['running', 'queued'].includes(j.status))} />
        {connection !== 'connected' && <p className="notice" role="status">أعد الاتصال بالخادم لفحص المشروع وتصديره.</p>}
        {draftBase && <p className="notice" role="status">أكمل التعديل الجاري قبل التصدير.</p>}
        {error && <p className="notice text-cut-text" role="alert">{error}</p>}
        <button className="btn btn-primary export-start" disabled={busy || checking || !!rangeError || !!draftBase || !canSubmitExport(check, rev, quality) || connection !== 'connected'} onClick={start}>{busy ? <Spinner size={16} /> : <Icon name="download" />}{busy ? 'جارٍ بدء التصدير…' : render ? 'أضف إلى طابور التصدير' : 'ابدأ التصدير'}</button>
        {queued && <div className="export-captured" role="status"><span>أُضيف: <b>{fileOf(queued.output)}</b></span><Version version={queued} /><p>يُحفظ في مجلد المشروع <code dir="ltr">renders/</code>. التعديلات التالية لا تغيّر هذه النسخة، ويمكنك إضافة تصدير آخر الآن.</p></div>}
        {lastRender && !recent.some((j) => j.result?.output === lastRender.output) && <ExportedActions url={lastRender.url} output={lastRender.output} reveal={reveal} />}
      </>}
      {initial === 'jobs' && error && <p className="notice text-cut-text" role="alert">{error}</p>}
      {!!recent.length || initial === 'jobs' ? <section className="job-list"><h3>{initial === 'jobs' ? 'المهام الأخيرة' : 'التصديرات'}</h3>{!recent.length && <div className="empty-state"><Icon name="clock" size={30} /><strong>كل شيء هادئ هنا</strong><p>تظهر مهام التحليل والتصدير عند تشغيلها.</p></div>}{recent.map((job) => <JobCard key={job.id} job={job} label={labels[job.status]} cancel={cancel} reveal={reveal} />)}</section> : null}
    </div>
  </Modal>;
}

function JobCard({ job, label, cancel, reveal }: { job: Job; label: string; cancel(id: string): void; reveal(output: string): void }) {
  const file = job.render?.output.split('/').pop();
  return <div className="job-card">
    <div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate">{job.kind === 'render' && file ? file : job.label}</strong><span className={job.status === 'error' ? 'text-cut-text' : 'text-ink-400'}>{label}</span></div>
    {job.render && <div className="job-version"><span>{job.label}</span><Version version={job.render} />{job.render.srt && <span>+ SRT</span>}</div>}
    {['queued', 'running'].includes(job.status) && <><progress className="job-progress" max={1} value={job.progress} /><div className="flex justify-between"><span className="num">{Math.round(job.progress * 100)}%</span><button className="btn btn-ghost" onClick={() => cancel(job.id)}>إلغاء المهمة</button></div></>}
    {job.error && <p className="mt-2 break-words text-cut-text">{job.error}</p>}
    {job.kind === 'render' && job.status === 'done' && job.result?.url && <ExportedActions url={job.result.url} output={job.result.output} reveal={reveal} />}
  </div>;
}

/** What to do with a finished export: watch it, find it on disk, or save a copy elsewhere. */
function ExportedActions({ url, output, reveal }: { url: string; output: string; reveal(output: string): void }) {
  return <div className="export-actions">
    <a className="btn" href={url} target="_blank" rel="noreferrer"><Icon name="play" />تشغيل</a>
    <button className="btn" onClick={() => reveal(output)}><Icon name="folder" />إظهار في المجلد</button>
    <a className="btn" href={url} download={output.split('/').pop()}><Icon name="download" />حفظ نسخة</a>
  </div>;
}

function Version({ version }: { version: { rev: number; snapshotId: string } }) {
  return <span className="export-version num" title={`معرّف النسخة: ${version.snapshotId}`}>r{version.rev}<span aria-hidden="true"> · </span><span>{version.snapshotId.slice(0, 8)}</span></span>;
}

/** What a viewer would notice: click one to see it on the timeline (the dialog stays open). */
function ReviewList({ findings }: { findings: ReviewFinding[] }) {
  const warn = findings.filter((f) => f.severity === 'warn').length;
  const { seek, select } = useStore.getState();
  return (
    <details className="export-issues export-warnings export-review" open={warn > 0}>
      <summary>مراجعة المونتاج ({warn ? `${warn} للإصلاح، ` : ''}{findings.length - warn} للنظر)</summary>
      <ul>{findings.map((f, i) => (
        <li key={`${f.code}-${i}`} data-severity={f.severity}>
          <button type="button" dir="rtl" className="export-review-item" title="اعرضها في التايملاين" onClick={() => { seek(f.at); if (f.clipIds.length) select(f.clipIds); }}>
            <span className="num" dir="ltr">{fmtTime(f.at, 1)}</span><span dir="auto">{f.message}</span>
          </button>
        </li>
      ))}</ul>
    </details>
  );
}
