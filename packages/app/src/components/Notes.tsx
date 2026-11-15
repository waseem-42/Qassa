import { useEffect, useRef, useState } from 'react';
import { fmtTime, clipEnd, speechClips, routeNotes, TIERS, type Note } from '@edit/shared';
import { useSlowTime, useStore, type Job } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { Icon, Spinner } from './Brand.tsx';
import { TranscriptNeeded } from './Transcribe.tsx';

// Comments pinned on the timeline: the user writes what should change at a moment (or a range),
// Claude reads them with the `notes` tool, edits, and replies / closes them. They follow their
// content when the edit changes, like every other clip off the main track.
// «نفّذ» on a comment (or on all open ones) starts an AI task on just those, on the tier they need;
// with settings.aiNotes the server starts one for every new comment by itself.

/** what a task on these comments will use and roughly cost, for the button's tooltip */
function plan(notes: Note[]) {
  const r = routeNotes(notes.map((n) => n.text));
  const t = TIERS[r.tier];
  return { ...r, label: t.label, hint: `${t.model} — ${r.why} · تقريباً $${t.estimate[0]}–${t.estimate[1]}، الحد $${t.budget}` };
}

async function runNotes(name: string, notes: Note[]) {
  try {
    await api.post(`${projectPath(name)}/agent`, { text: '', tier: plan(notes).tier, notes: notes.map((n) => n.id) });
  } catch (e) {
    useStore.getState().notify((e as Error).message);
  }
}

/** the newest AI task on this comment */
function useNoteJob(id: string): Job | undefined {
  return useStore((s) => {
    let best: Job | undefined;
    for (const j of Object.values(s.jobs)) if (j.kind === 'agent' && j.notes?.includes(id) && (!best || j.createdAt > best.createdAt)) best = j;
    return best;
  });
}

export function Notes() {
  const notes = useStore((s) => s.project!.notes);
  const name = useStore((s) => s.name)!;
  const auto = useStore((s) => s.project!.settings.aiNotes);
  const busy = useStore((s) => Object.values(s.jobs).some((j) => j.kind === 'agent' && j.project === name && (j.status === 'queued' || j.status === 'running') && j.notes?.length));
  const draft = useStore((s) => s.noteDraft);
  const focus = useStore((s) => s.focusNote);
  const [showDone, setShowDone] = useState(false);
  const open = notes.filter((n) => n.status === 'open');
  // comments the AI worked on since the editor opened stay in the list after it closes them, so its reply is seen
  const worked = useStore((s) => Object.values(s.jobs).flatMap((j) => (j.kind === 'agent' && j.project === name ? j.notes ?? [] : [])).join(' '));
  const shown = showDone ? notes : notes.filter((n) => n.status === 'open' || worked.split(' ').includes(n.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 p-2">
        <button className="btn btn-primary h-7 text-xs" onClick={() => useStore.getState().startNote()} title="C">+ تعليق عند المؤشر</button>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-ink-400">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> المنتهية ({notes.length - open.length})
        </label>
      </div>
      {draft && <Draft key={`${draft.at}`} />}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {shown.length ? shown.map((n) => <NoteCard key={n.id} note={n} index={notes.indexOf(n) + 1} focused={n.id === focus} />) : !draft && (
          <div className="p-6 text-center text-sm leading-7 text-ink-500">
            وقّف على أي لحظة واضغط <b className="text-ink-300">C</b> واكتب وش تبي يتغيّر هناك.
            <br />بعدين اضغط «نفّذ» على التعليق ويشتغل عليه الذكاء ويرد عليك هنا.
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t border-ink-800 p-2 text-[11px] text-ink-500">
        {open.length > 1 && (
          <button className="btn h-7 w-full justify-center text-xs" disabled={busy} title={plan(open).hint} onClick={() => runNotes(name, open)}>
            <Icon name="sparkles" size={13} /> نفّذ كل المفتوحة ({open.length}) · {plan(open).label}
          </button>
        )}
        <label className="flex items-start gap-1.5 leading-5" title="كل تعليق جديد تكتبه يبدأ عليه الذكاء مباشرة بالمستوى اللي يحتاجه. التعليقات الكبيرة (رسمة جديدة، مونتاج كامل) تنتظر ضغطتك.">
          <input type="checkbox" className="mt-1" checked={auto} onChange={(e) => useStore.getState().ops([{ op: 'set_settings', patch: { aiNotes: e.target.checked } }])} />
          <span>نفّذ كل تعليق جديد تلقائياً <span className="text-ink-600">(تكلفة كل تعليق تبان في «اطلب من الذكاء»)</span></span>
        </label>
      </div>
    </div>
  );
}

function Draft() {
  const draft = useStore((s) => s.noteDraft)!;
  const time = useSlowTime();
  const { ops, setNoteDraft, seek } = useStore.getState();
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);

  const save = async () => {
    if (!text.trim()) return setNoteDraft(undefined);
    const ok = await ops([{ op: 'add_note', note: { at: draft.at, end: draft.end, text: text.trim(), author: 'user' } }]);
    if (ok) setNoteDraft(undefined);
  };
  const canEnd = time > draft.at + 0.05;
  return (
    <div className="shrink-0 border-b border-ink-800 bg-ink-850 p-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-ink-400">
        <button className="num text-note" onClick={() => seek(draft.at)}>{fmtTime(draft.at, 2)}{draft.end !== undefined && ` – ${fmtTime(draft.end, 2)}`}</button>
        <div className="flex-1" />
        {draft.end === undefined ? (
          <button className="btn btn-ghost h-6 text-[11px]" disabled={!canEnd} title="حرّك المؤشر لنهاية الجزء ثم اضغط" onClick={() => setNoteDraft({ ...draft, end: time })}>
            ⟷ مدى لين المؤشر
          </button>
        ) : (
          <button className="btn btn-ghost h-6 text-[11px]" onClick={() => setNoteDraft({ at: draft.at })}>لحظة بس</button>
        )}
      </div>
      <textarea
        ref={box}
        className="field h-20 w-full resize-none py-1.5 leading-6"
        placeholder="مثلاً: زوم على الشاشة هنا · احذف هذا الجزء · حط عنوان «…» · الصوت عالي"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
          if (e.key === 'Escape') setNoteDraft(undefined);
        }}
      />
      <div className="mt-1 flex gap-2">
        <button className="btn btn-primary h-7 text-xs" onClick={save}>حفظ (Enter)</button>
        <button className="btn btn-ghost h-7 text-xs" onClick={() => setNoteDraft(undefined)}>إلغاء</button>
      </div>
    </div>
  );
}

function NoteCard({ note: n, index, focused }: { note: Note; index: number; focused: boolean }) {
  const { ops, seek } = useStore.getState();
  const time = useSlowTime();
  const name = useStore((s) => s.name)!;
  const project = useStore((s) => s.project)!;
  const contextIds = [...new Set(speechClips(project).filter((c) => c.start <= n.at && clipEnd(c) > n.at).map((c) => c.mediaId!))];
  const job = useNoteJob(n.id);
  const working = job?.status === 'queued' || job?.status === 'running';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.text);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => setText(n.text), [n.text]);
  useEffect(() => {
    if (focused) el.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  const here = time >= n.at - 0.05 && time <= (n.end ?? n.at) + 0.05;
  const done = n.status === 'done';

  return (
    <div ref={el} className="mb-2 rounded-md border bg-ink-850 p-2 text-sm"
      style={{ borderColor: focused || here ? 'var(--color-note)' : 'var(--color-ink-800)', opacity: done ? 0.6 : 1 }}>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-ink-950" style={{ background: done ? 'var(--color-ink-500)' : 'var(--color-note)' }}>{index}</span>
        <button className="num text-note hover:underline" onClick={() => seek(n.at)} title="انتقل">
          {fmtTime(n.at, 2)}{n.end !== undefined && ` – ${fmtTime(n.end, 2)}`}
        </button>
        <span className="text-ink-500">{n.author === 'claude' ? 'سؤال من الـ AI' : ''}</span>
        <div className="flex-1" />
        {!done && !working && n.author === 'user' && (
          <button className="btn btn-ghost h-6 px-1.5 text-[11px] text-accent" title={plan([n]).hint} onClick={() => runNotes(name, [n])}>
            <Icon name="sparkles" size={12} /> نفّذ · {plan([n]).label}
          </button>
        )}
        <button className="btn btn-ghost h-6 px-1.5 text-[11px]" onClick={() => ops([{ op: 'update_note', id: n.id, patch: { status: done ? 'open' : 'done' } }])}>
          {done ? '↺ افتح' : '✓ تم'}
        </button>
        <button className="btn btn-ghost h-6 px-1.5 text-[11px] text-cut-text" onClick={() => ops([{ op: 'delete_note', id: n.id }])}>حذف</button>
      </div>
      {editing ? (
        <textarea className="field h-16 w-full resize-none py-1 leading-6" autoFocus value={text} onChange={(e) => setText(e.target.value)}
          onBlur={() => { setEditing(false); if (text.trim() && text !== n.text) ops([{ op: 'update_note', id: n.id, patch: { text: text.trim() } }]); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) (e.target as HTMLTextAreaElement).blur(); }} />
      ) : (
        <div className={`cursor-text whitespace-pre-wrap leading-6 ${done ? 'line-through decoration-ink-500' : 'text-ink-200'}`} onDoubleClick={() => setEditing(true)} title="دبل كلك للتعديل">{n.text}</div>
      )}
      <TranscriptNeeded mediaIds={contextIds} text="سياق الكلام يحتاج تفريغًا؛ يمكنك تعديل التعليق وتنفيذه بدونه." />
      {working && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-400">
          <Spinner size={12} />
          <span className="min-w-0 flex-1 truncate" dir="auto">{job!.status === 'queued' ? 'ينتظر دوره…' : job!.message ?? 'الذكاء يقرأ التعليق…'}</span>
          <button className="btn btn-ghost h-6 px-1.5 text-[11px]" onClick={() => api.post(`/api/jobs/${job!.id}/cancel`).catch(() => {})}>إيقاف</button>
        </div>
      )}
      {job?.status === 'error' && !done && <div className="mt-2 text-[11px] leading-5 text-cut-text" dir="auto">ما كمل: {job.error}</div>}
      {n.reply && (
        <div className="mt-2 rounded border-r-2 border-accent bg-ink-900 px-2 py-1 text-xs leading-5 text-ink-300">
          <span className="text-accent">AI:</span> {n.reply}
        </div>
      )}
    </div>
  );
}
