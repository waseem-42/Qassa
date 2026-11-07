import { useState } from 'react';
import { speechMediaIds, TRANSCRIBE_STEPS } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { useRuntime } from './RuntimeSettings.tsx';

export function TranscribeButton({ mediaId, label = 'فرّغ الكلام' }: { mediaId: string; label?: string }) {
  const name = useStore((s) => s.name)!;
  const jobs = useStore((s) => s.jobs);
  const [busy, setBusy] = useState(false);
  const setupNeeded = useRuntime((s) => s.runtime?.desktop && !s.runtime.ready);
  const job = Object.values(jobs).find((j) => j.kind === 'analyze' && j.mediaId === mediaId && j.steps?.includes('transcribe') && ['queued', 'running'].includes(j.status));
  return <button className="btn h-7 px-2 text-[11px]" disabled={busy || !!job} onClick={async () => {
    if (setupNeeded) return useRuntime.getState().setOpen(true);
    setBusy(true);
    try {
      await api.post(`${projectPath(name)}/analyze`, { mediaId, steps: TRANSCRIBE_STEPS });
      useStore.getState().notify('بدأ تفريغ الكلام بطلبك', 'info');
    } catch (e) { useStore.getState().notify((e as Error).message); }
    finally { setBusy(false); }
  }}>{setupNeeded ? 'يحتاج إكمال التجهيز' : job ? job.message?.startsWith('المساعد يحتاج التفريغ') ? job.message : `يفرّغ الكلام · ${Math.round(job.progress * 100)}٪` : busy ? 'يرسل الطلب…' : label}</button>;
}

export function TranscriptNeeded({ mediaIds, text = 'يحتاج تفريغ' }: { mediaIds?: string[]; text?: string }) {
  const project = useStore((s) => s.project)!;
  const ids = mediaIds ?? speechMediaIds(project);
  const missing = project.media.filter((m) => ids.includes(m.id) && !m.analyzed.includes('transcribe'));
  if (!missing.length) return null;
  return <div className="my-2 space-y-2 text-xs text-ink-400" data-transcript-needed>
    <p>{text}</p>{missing.map((m) => <div key={m.id} className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate" dir="auto">{m.name}</span><TranscribeButton mediaId={m.id} /></div>)}
  </div>;
}
