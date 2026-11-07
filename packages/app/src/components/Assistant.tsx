import { useMemo, useState } from 'react';
import { fmtTime, mainDuration, reviewSavings, reviewTime, type Suggestion } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { AgentTasks } from './AgentTasks.tsx';
import { Ideas } from './Ideas.tsx';
import { TranscriptNeeded } from './Transcribe.tsx';
import { acceptOps, readTuning, saveTuning, tooShort, tunedRanges, type SilenceTuning } from '../lib/silence-tuning.ts';

const reasons: Record<Suggestion['reason'], string> = {
  silence: 'صمت', retake: 'إعادة تسجيل', filler: 'كلمات زائدة', mistake: 'خطأ', other: 'أخرى',
};

export function Assistant() {
  const project = useStore((s) => s.project)!;
  const name = useStore((s) => s.name)!;
  const jobs = useStore((s) => s.jobs);
  const { ops, seek, setPlaying, notify } = useStore.getState();
  const [filter, setFilter] = useState('all');
  // every suggestion starts ticked, so the saving shows at once; the user unticks what to keep
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const visible = useMemo(() => project.suggestions.filter((s) => filter === 'all' || s.reason === filter), [project.suggestions, filter]);
  const [tuning, setTuningState] = useState(readTuning);
  const setTuning = (t: SilenceTuning) => { setTuningState(t); saveTuning(t); };
  const picked = project.suggestions.filter((s) => !excluded.includes(s.id));
  const ticked = (id: string) => !excluded.includes(id);
  const toCut = tunedRanges(picked, tuning);
  const saved = reviewSavings(project, toCut);
  const silences = project.suggestions.filter((s) => s.reason === 'silence');
  const leftAlone = silences.filter((s) => tooShort(s, tuning)).length;
  const duration = mainDuration(project);
  const active = Object.values(jobs).filter((j) => j.kind === 'analyze' && ['queued', 'running'].includes(j.status));
  const sources = project.media.filter((m) => m.role === 'source' && m.kind !== 'image');
  const missing = sources.filter((m) => !m.analyzed.includes('silence'));
  const analyze = async () => {
    setBusy(true);
    try {
      for (const m of missing) await api.post(`${projectPath(name)}/analyze`, { mediaId: m.id, steps: ['silence', 'summary'] });
      notify('تم إرسال الملفات للتحليل', 'info');
    } catch (e) { notify((e as Error).message); }
    finally { setBusy(false); }
  };
  const resolve = async (accept: boolean) => {
    setBusy(true);
    try {
      if (await ops(accept ? acceptOps(picked, tuning) : [{ op: 'resolve_suggestions', ids: picked.map((s) => s.id), accept }])) {
        setExcluded([]);
        notify(accept ? 'تم تطبيق القص — يمكنك التراجع بخطوة واحدة' : 'تم استبعاد الاقتراحات المحددة', 'info');
      }
    } finally { setBusy(false); }
  };
  const suggestions = project.suggestions.length > 0 && (
    <>
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-accent">قص جاهز من التحليل</span>
          <span className="text-ink-500">مجاني — بدون ذكاء</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="num text-base">{fmtTime(duration, 1)} ← {fmtTime(Math.max(0, duration - saved), 1)}</span><span className="text-xs text-ink-400">توفير {fmtTime(saved, 1)}</span></div>
        <p className="mt-2 text-[11px] leading-5 text-ink-400">{picked.length} من {project.suggestions.length} محددة — شيل علامة اللي تبي تخليه، و«انتقل» يوريك المكان قبل القص.</p>
        {silences.length > 0 && <div className="silence-tuning">
          <label><span>أقصر سكتة تُقص</span><input type="range" min={0} max={3} step={0.1} value={tuning.min} onChange={(e) => setTuning({ ...tuning, min: Number(e.target.value) })} aria-valuetext={tuning.min ? `${tuning.min} ثانية` : 'كل السكتات'} /><output className={tuning.min ? 'num' : undefined}>{tuning.min ? `${tuning.min.toFixed(1)} ث` : 'الكل'}</output></label>
          <label title="يترك هذا القدر من الصمت عند طرفي كل سكتة، عشان الكلام ما يلتصق ببعضه"><span>نَفَس عند الأطراف</span><input type="range" min={0} max={0.5} step={0.05} value={tuning.pad} onChange={(e) => setTuning({ ...tuning, pad: Number(e.target.value) })} aria-valuetext={tuning.pad ? `${tuning.pad} ثانية` : 'بدون'} /><output className={tuning.pad ? 'num' : undefined}>{tuning.pad ? `${tuning.pad.toFixed(2)} ث` : 'بدون'}</output></label>
          {leftAlone > 0 && <p>{leftAlone} سكتة أقصر من الحد تبقى كما هي.</p>}
        </div>}
        <div className="mt-3 flex gap-2">
          <button className="btn btn-primary flex-1 justify-center" disabled={busy || !toCut.length || !saved || saved >= duration} onClick={() => resolve(true)}>قص المحدد ({toCut.length})</button>
          <button className="btn" disabled={busy || !picked.length} title="تجاهل هذي الاقتراحات" onClick={() => resolve(false)}>تجاهل</button>
        </div>
        {saved > 0 && saved >= duration && <p className="mt-2 text-xs text-cut-text">هذه الاقتراحات تحذف المقطع كاملًا؛ قلّل التحديد.</p>}
      </div>
      <div className="flex items-center gap-2">
        <select aria-label="نوع الاقتراح" className="field min-w-0 flex-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">كل الاقتراحات ({project.suggestions.length})</option>
          {Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button className="btn text-xs" disabled={busy || !visible.length} onClick={() => setExcluded(excluded.filter((id) => !visible.some((s) => s.id === id)))}>حدّد الظاهر</button>
        <button className="btn btn-ghost text-xs" disabled={busy || !visible.length} onClick={() => setExcluded([...new Set([...excluded, ...visible.map((s) => s.id)])])}>ألغِ الظاهر</button>
      </div>
      {!visible.length && <p className="rounded-lg border border-dashed border-ink-700 p-4 text-xs leading-6 text-ink-400">لا توجد اقتراحات في هذه الفئة.</p>}
      {visible.map((s) => {
        const at = reviewTime(project, s), short = tooShort(s, tuning);
        return <div key={s.id} className="rounded-lg border border-ink-700 bg-ink-850 p-3" data-left-alone={short || undefined}>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" disabled={busy} checked={ticked(s.id)} onChange={(e) => setExcluded(e.target.checked ? excluded.filter((id) => id !== s.id) : [...excluded, s.id])} />
            <span className="text-sm">{reasons[s.reason]}</span>
            {short && <span className="text-[11px] text-ink-500">أقصر من الحد — تبقى</span>}
            <span className="num mr-auto text-xs text-ink-400">{fmtTime(s.t0, 1)}–{fmtTime(s.t1, 1)}</span>
          </label>
          <p className="mt-2 truncate text-xs text-ink-500">{project.media.find((m) => m.id === s.mediaId)?.name ?? s.mediaId}</p>
          {s.note && <p className="mt-2 text-xs leading-6 text-ink-300" dir="auto">{s.note}</p>}
          <button className="btn btn-ghost mt-2 text-xs" disabled={at === null} onClick={() => { setPlaying(false); seek(Math.max(0, (at ?? 0) - 0.5)); }}>{at === null ? 'المحتوى مقصوص بالفعل' : 'انتقل لمراجعة موضع القص'}</button>
        </div>;
      })}
    </>
  );

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <AgentTasks compact={!project.ideas.length} />
      {suggestions}
      <TranscriptNeeded compact={!project.ideas.length} text="اقتراحات الإعادات والقص بالكلمات تحتاج تفريغًا؛ فحص الصمت لا يفرّغ الكلام." />
      <Ideas />
      {(!sources.length || missing.length > 0 || active.length > 0) ? (
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
          <div className="mb-2 flex justify-between text-xs"><span>تحليل الملفات</span><span>{sources.length - missing.length} / {sources.length}</span></div>
          <button className="btn w-full justify-center" disabled={busy || !!active.length || !missing.length} onClick={analyze}>
            {active.length ? `جارٍ التحليل · ${active.length} مهمة` : missing.length ? `تحليل ${missing.length} ملف` : 'أضف مقطعًا من الوسائط للبدء'}
          </button>
          {active.length > 0 && <p className="mt-2 text-[11px] leading-5 text-ink-500">اقتراحات القص (السكتات والإعادات) تطلع هنا أول ما يخلص.</p>}
        </div>
      ) : !project.suggestions.length && <p className="text-[11px] leading-5 text-ink-500">التحليل مكتمل وما فيه اقتراحات قص — تقدر تقص من «النص» أو تطلب من الذكاء.</p>}
      <div className="rounded-xl border border-ink-700 p-3">
        <h3 className="mb-2 text-sm">مقاس الفيديو</h3>
        <div className="flex gap-2">
          {([['16:9', 'يوتيوب'], ['9:16', 'شورتس'], ['1:1', 'مربع']] as const).map(([aspect, label]) => <button key={aspect} className={`btn flex-1 justify-center text-xs ${project.settings.aspect === aspect ? 'border-accent text-accent' : ''}`} aria-pressed={project.settings.aspect === aspect} disabled={busy} onClick={() => ops([{ op: 'set_settings', patch: { aspect } }])}>{label} {aspect}</button>)}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-ink-400">راجع تأطير اللقطات في المعاينة بعد تغيير المقاس.</p>
      </div>
    </div>
  );
}
