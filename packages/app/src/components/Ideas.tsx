import { useState } from 'react';
import { fmtTime, IDEA_KINDS, ideaSpan, TIERS, type Idea } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { Icon, Spinner } from './Brand.tsx';
import { useTemplates } from './GraphicControls.tsx';
import { TranscriptNeeded } from './Transcribe.tsx';

// Visual ideas over the speech (b-roll, graphics, words on screen, shots to film): the AI proposes them
// from what is said, they wait here and as dashed marks on the timeline; nothing is added until the user says.

/** what an idea would put on screen, in a few words */
function useWhat(): (idea: Idea) => string {
  const name = useStore((s) => s.name)!;
  const media = useStore((s) => s.project!.media);
  const { library, own } = useTemplates(name);
  const firstText = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : Array.isArray(v) ? v.map(firstText).filter(Boolean).join(' · ') || undefined : v && typeof v === 'object' ? Object.values(v).map(firstText).find(Boolean) : undefined;
  return (idea) => {
    switch (idea.kind) {
      case 'graphic': {
        const t = [...library, ...own].find((x) => x.graphic === idea.graphic);
        const data = idea.graphicData && (firstText(idea.graphicData.title) ?? firstText(idea.graphicData));
        return [t?.name ?? idea.graphic?.replace(/^(lib|graphics)\//, ''), data && `«${data.slice(0, 60)}»`].filter(Boolean).join(' ');
      }
      case 'text': return `«${idea.text}»`;
      case 'broll': {
        const m = media.find((x) => x.id === idea.source?.mediaId);
        return `${m?.name ?? idea.source?.mediaId} ${m?.kind === 'image' ? '' : `${fmtTime(idea.source!.in, 1)}–${fmtTime(idea.source!.out, 1)}`}`;
      }
      case 'shot': return idea.search ? `ابحث عن: ${idea.search}` : '';
    }
  };
}

export function Ideas() {
  const project = useStore((s) => s.project)!;
  const name = useStore((s) => s.name)!;
  const jobs = useStore((s) => s.jobs);
  const { ops, seek, setPlaying, notify } = useStore.getState();
  const [busy, setBusy] = useState(false);
  const what = useWhat();
  const transcribed = project.media.some((m) => m.analyzed.includes('transcribe'));
  const running = Object.values(jobs).find((j) => j.kind === 'agent' && j.project === name && j.ideas && ['queued', 'running'].includes(j.status));
  const ideas = project.ideas;
  if (!project.media.some((m) => m.hasAudio) && !ideas.length) return null;

  const ask = async () => {
    setBusy(true);
    try { await api.post(`${projectPath(name)}/agent`, { text: '', tier: 'standard', ideas: true }); }
    catch (e) { notify((e as Error).message); }
    finally { setBusy(false); }
  };
  const resolve = async (ids: string[] | 'all', accept: boolean) => {
    setBusy(true);
    try {
      if (await ops([{ op: 'resolve_ideas', ids, accept }]) && accept) notify(ids === 'all' || ids.length > 1 ? 'انضافت للتايملاين — تقدر تتراجع بخطوة وحدة' : 'انضافت للتايملاين', 'info');
    } finally { setBusy(false); }
  };
  const est = TIERS.standard.estimate;

  return (
    <div className="rounded-xl border border-clip-overlay/40 bg-clip-overlay/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Icon name="sparkles" size={15} />
        <span className="flex-1 text-ink-200">أفكار بصرية {ideas.length > 0 && <span className="num">({ideas.length})</span>}</span>
        {ideas.length > 1 && (
          <>
            <button className="btn btn-ghost h-6 px-2 text-[11px]" disabled={busy} onClick={() => resolve('all', true)}>أضف الكل</button>
            <button className="btn btn-ghost h-6 px-2 text-[11px]" disabled={busy} onClick={() => resolve('all', false)}>تجاهل الكل</button>
          </>
        )}
      </div>
      {!ideas.length && <p className="mb-2 text-[11px] leading-5 text-ink-400">الذكاء يقرأ الكلام ويقترح وش يطلع على الشاشة: رسمة من القوالب، كلمة على الشاشة، لقطة من ملفات البي-رول، أو لقطة تحتاج تصوّرها. ما ينضاف شيء إلا لما توافق.</p>}
      {!transcribed && <TranscriptNeeded text="اقتراح أفكار على الكلام يحتاج تفريغًا" />}
      {ideas.map((idea) => {
        const span = ideaSpan(project, idea);
        return (
          <div key={idea.id} id={`idea-${idea.id}`} className="idea-card mb-2 rounded-lg border border-ink-700 bg-ink-850 p-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded bg-clip-overlay/25 px-1.5 py-0.5 text-[11px] text-ink-200">{IDEA_KINDS[idea.kind]}</span>
              <button className="num mr-auto text-ink-400 hover:text-white" disabled={!span} title="انتقل لمكانها"
                onClick={() => { if (span) { setPlaying(false); seek(span.start); } }}>{span ? fmtTime(span.start, 1) : 'كلامها انقص'}</button>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-ink-200" dir="auto">{idea.note}</p>
            {what(idea) && <p className="mt-1 truncate text-[11px] text-ink-500" dir="auto" title={what(idea)}>{what(idea)}</p>}
            <div className="mt-2 flex gap-1">
              <button className="btn h-6 flex-1 justify-center text-[11px]" disabled={busy || !span} onClick={() => resolve([idea.id], true)}>{idea.kind === 'shot' ? 'خلّها تعليق' : 'أضف'}</button>
              <button className="btn btn-ghost h-6 px-3 text-[11px]" disabled={busy} onClick={() => resolve([idea.id], false)}>تجاهل</button>
            </div>
          </div>
        );
      })}
      {running ? (
        <div className="flex items-center gap-2 text-[11px] text-ink-400"><Spinner size={13} /><span className="min-w-0 flex-1 truncate">{running.message ?? 'يقرأ الكلام…'}</span></div>
      ) : transcribed && (
        <button className="btn w-full justify-center text-xs" disabled={busy} title={`النموذج المتوسط — تقريبًا ${est[0]}–${est[1]}$`} onClick={ask}>
          {ideas.length ? 'اقترح أفكار ثانية' : 'اقترح بي-رول وشروحات'} <span className="num text-ink-500" dir="ltr">~${est[0]}–{est[1]}</span>
        </button>
      )}
    </div>
  );
}
