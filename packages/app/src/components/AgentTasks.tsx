import { useEffect, useMemo, useState } from 'react';
import { routeByRules, TIERS, type Tier } from '@edit/shared';
import { useStore, type Job } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { Icon, Spinner } from './Brand.tsx';
import { autoCaptions } from './Inspector.tsx';
import { TranscriptNeeded } from './Transcribe.tsx';

// Ask the AI from inside the editor. Before anything is spent the request is routed to the smallest
// model that can do it (rules here, the server's small model when no rule fits) and the estimate is
// shown; the user can pick another tier. Running tasks stream their steps; finished ones show the
// reply and what they really cost.

interface Route { tier: Tier; why: string; by: 'rules' | 'model'; cost?: number }
interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
interface TaskLog { at: number; text: string; tier: Tier; model: string; cost: number; turns: number; durationMs: number; usage?: Usage; error?: string }

const MODEL_NAME: Record<string, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };
/** 32716 → 32.7k, 1843286 → 1.8M */
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
/** what a finished task used: the model, the tokens it wrote and read (the 5-hour limit counts these), the time */
function usageLine(model: string, usage: Usage | undefined, durationMs: number): string {
  const parts = [MODEL_NAME[model] ?? model];
  if (usage) parts.push(`${tokens(usage.output)} كتابة`, `${tokens(usage.input + usage.cacheWrite)} قراءة جديدة`, `${tokens(usage.cacheRead)} من الكاش`);
  parts.push(durationMs >= 60000 ? `${(durationMs / 60000).toFixed(1)} د` : `${Math.round(durationMs / 1000)} ث`);
  return parts.join(' · ');
}

const usd = (v: number) => (v < 0.01 ? `${v.toFixed(3)}` : `${v.toFixed(2)}`);
/** an amount (or range) kept left-to-right inside Arabic text */
const Usd = ({ children }: { children: string }) => <bdi className="num" dir="ltr">{children}</bdi>;
const IDEAS = ['قص السكتات الطويلة', 'غيّر لون العناوين للون الهوية', 'حط رسمة خطوات للي يشرحه'];

export function AgentTasks() {
  const name = useStore((s) => s.name)!;
  const jobs = useStore((s) => s.jobs);
  const openNotes = useStore((s) => s.project!.notes.some((n) => n.status === 'open'));
  const transcribed = useStore((s) => s.project!.media.some((m) => m.analyzed.includes('transcribe')));
  const { notify } = useStore.getState();
  const [text, setText] = useState('');
  const [route, setRoute] = useState<Route>();
  const [tier, setTier] = useState<Tier>();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ tasks: TaskLog[]; total: number }>({ tasks: [], total: 0 });
  // the rules answer as you type; only an unmatched request asks the server's small model (on send)
  const local = useMemo(() => routeByRules(text), [text]);
  const shown: Tier | undefined = tier ?? route?.tier ?? local?.tier;
  const agentJobs = Object.values(jobs).filter((j) => j.kind === 'agent' && j.project === name).sort((a, b) => b.createdAt - a.createdAt);
  const finished = agentJobs.filter((j) => j.status === 'done' || j.status === 'error').length;

  useEffect(() => { setRoute(undefined); setTier(undefined); }, [text]);
  useEffect(() => { api.get(`${projectPath(name)}/agent/log`).then(setLog).catch(() => {}); }, [name, finished]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      let pick = shown;
      if (!pick) {
        // no rule fits: ask first, and let the user confirm the tier before the real run
        const r = await api.post<Route>(`${projectPath(name)}/agent/route`, { text: t });
        setRoute(r);
        return;
      }
      const { time, selected } = useStore.getState();
      await api.post(`${projectPath(name)}/agent`, { text: t, tier: pick, time, selected });
      setText('');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const info = shown && TIERS[shown];
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Icon name="sparkles" size={15} />
        <span className="flex-1">اطلب من الذكاء</span>
        {log.total > 0 && <span className="num text-ink-500" title="كل اللي صُرف على طلبات هذا المشروع">صُرف <Usd>{usd(log.total)}</Usd></span>}
      </div>
      <textarea className="field min-h-[64px] w-full resize-y py-2 text-sm leading-6" dir="auto" value={text} placeholder="مثلاً: كبّر العنوان الأول وخلّه أصفر"
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} />
      {!text && (
        <div className="mt-1 flex flex-wrap gap-1">
          {(openNotes ? ['نفّذ التعليقات', ...IDEAS] : IDEAS).map((i) => <button key={i} className="btn btn-ghost h-6 px-2 text-[11px]" onClick={() => setText(i)}>{i}</button>)}
          <button className="btn btn-ghost h-6 px-2 text-[11px] text-accent" title="من الكلام المفرّغ، بدون ذكاء وبدون تكلفة" onClick={autoCaptions}>كابشن من الكلام · مجاني</button>
        </div>
      )}
      {!transcribed && <TranscriptNeeded text="الكابشن والقص بالكلمات يحتاجان تفريغًا" />}
      {text.trim() && (
        <div className="mt-2 rounded-lg border border-ink-700 p-2">
          <div className="seg-buttons mb-2 w-full">
            {(Object.keys(TIERS) as Tier[]).map((t) => (
              <button key={t} className="btn flex-1 justify-center text-xs" aria-pressed={shown === t} title={TIERS[t].about} onClick={() => setTier(t)}>{TIERS[t].label}</button>
            ))}
          </div>
          {info ? (
            <div className="text-[11px] leading-5 text-ink-400">
              <span className="text-ink-200">{info.model} · جهد {info.effort === 'low' ? 'منخفض' : info.effort === 'medium' ? 'متوسط' : 'عالٍ'}</span>
              {' — '}{tier ? 'اخترته أنت' : (route ?? local)?.why}{route?.cost ? ` (التصنيف كلّف ${usd(route.cost)})` : ''}
              <div>التكلفة المتوقعة <span className="text-ink-200"><Usd>{`${usd(info.estimate[0])}–${usd(info.estimate[1])}`}</Usd></span> · الحد الأقصى <Usd>{usd(info.budget)}</Usd></div>
            </div>
          ) : <div className="text-[11px] text-ink-500">ما عرفت حجم الطلب من كلماته — اضغط «اطلب» ويصنّفه نموذج صغير (أقل من سنت)، أو اختر بنفسك.</div>}
        </div>
      )}
      <button className="btn btn-primary mt-2 w-full justify-center" disabled={busy || !text.trim()} onClick={send}>
        {busy ? <Spinner size={14} /> : null}{shown ? `اطلب (${TIERS[shown].label})` : 'اطلب'}
      </button>

      {agentJobs.length > 0 && <div className="mt-3 space-y-2">{agentJobs.slice(0, 6).map((j) => <TaskCard key={j.id} job={j} />)}</div>}
      {log.tasks.length > agentJobs.length && (
        <details className="mt-3 text-[11px] text-ink-500">
          <summary className="cursor-pointer">طلبات سابقة ({log.tasks.length})</summary>
          {log.tasks.slice(0, 30).map((t) => (
            <div key={t.at} className="mt-1 flex gap-2 border-t border-ink-800 pt-1">
              <span className="min-w-0 flex-1 truncate" dir="auto" title={t.text}>{t.error ? '⚠ ' : ''}{t.text}</span>
              <span className="num shrink-0" title={usageLine(t.model, t.usage, t.durationMs)}>{MODEL_NAME[t.model] ?? t.model}{t.usage ? ` · ${tokens(t.usage.output)}` : ''} · {usd(t.cost)}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/** 75 → 1:15 */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function TaskCard({ job }: { job: Job }) {
  const live = job.status === 'queued' || job.status === 'running';
  const r = job.result as { reply?: string; cost?: number; model?: string; durationMs?: number; usage?: Usage } | undefined;
  // a running task ticks once a second so its elapsed time moves between progress reports
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const pct = Math.round(job.progress * 100);
  return (
    <div className={`rounded-lg border p-2 text-xs ${job.status === 'error' ? 'border-cut/40' : live ? 'border-accent/40' : 'border-ink-700'}`}>
      <div className="flex items-center gap-2">
        {live && <Spinner size={12} />}
        <span className="min-w-0 flex-1 truncate text-ink-200" dir="auto" title={job.label}>{job.label}</span>
        {live && <button className="btn btn-ghost h-6 px-2 text-[11px]" onClick={() => api.post(`/api/jobs/${job.id}/cancel`).catch(() => {})}>إيقاف</button>}
        {r?.cost !== undefined && <span className="num shrink-0 text-ink-400" title={`${r.model} · ${Math.round((r.durationMs ?? 0) / 1000)} ث`}>{usd(r.cost)}</span>}
      </div>
      {job.status === 'running' && (
        <>
          <div className="mt-2 flex justify-between text-[11px] text-ink-400"><span className="num">{pct}%</span><span className="num" title="الوقت من بداية الطلب">{clock((now - job.createdAt) / 1000)}</span></div>
          <div className="mt-1 h-1 overflow-hidden rounded bg-ink-700"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
        </>
      )}
      {live && <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-ink-500" dir="auto" title={job.message}>{job.status === 'queued' ? 'ينتظر دوره…' : job.message ?? 'يبدأ…'}</div>}
      {job.status === 'done' && r?.reply && <p className="mt-1 whitespace-pre-line text-[11px] leading-5 text-ink-300" dir="auto">{r.reply}</p>}
      {job.status === 'done' && r?.model && <p className="num mt-1 text-[11px] text-ink-500" title="التوكنز اللي استخدمها — حد الخمس ساعات يحسبها (قراءة الكاش أخف بكثير)">{usageLine(r.model, r.usage, r.durationMs ?? 0)}</p>}
      {job.status === 'error' && <p className="mt-1 text-[11px] leading-5 text-cut-text" dir="auto">{job.error}</p>}
      {job.status === 'cancelled' && <p className="mt-1 text-[11px] text-ink-500">أُوقف.</p>}
    </div>
  );
}
