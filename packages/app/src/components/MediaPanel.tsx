import { useEffect, useRef, useState } from 'react';
import { clipDuration, fmtTime, mainClips, MAIN_TRACK, type Clip, type Media, type Project } from '@edit/shared';
import { useStore, type Job } from '../lib/store.ts';
import { api, fileUrl, projectPath } from '../lib/api.ts';
import { Icon } from './Brand.tsx';
import { SourceRange } from './SourceRange.tsx';
import { importFiles, MEDIA_DRAG, placeMedia, placeMediaRun, removeMedia, selectMedia, setDraggingMedia, useMediaSelection } from '../lib/import.ts';
import { PopupMenu } from './PopupMenu.tsx';
import { Modal } from './Modal.tsx';
import { Uploads } from './Uploads.tsx';
import { TranscribeButton } from './Transcribe.tsx';

const ROLES: { id: Media['role']; label: string; hint: string }[] = [
  { id: 'source', label: 'مقطع', hint: 'المقطع اللي تبي تمنتجه — ينحط على التايملاين ويتحلل' },
  { id: 'ref', label: 'رفرنس', hint: 'مقطع أو صورة بالستايل اللي تبيه' },
  { id: 'broll', label: 'لقطات فوقية', hint: 'لقطات إضافية فوق المقطع' },
  { id: 'music', label: 'موسيقى', hint: 'موسيقى خلفية (تنخفض تلقائياً تحت الكلام)' },
];

export function MediaPanel() {
  const [tab, setTab] = useState<'media' | 'shots' | 'style'>('media');
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-ink-800">
        {([['media', 'الوسائط'], ['shots', 'اللقطات'], ['style', 'الستايل']] as const).map(([id, l]) => (
          <button key={id} className="tab" data-guide-tab={id} data-on={tab === id} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' ? <MediaList /> : tab === 'shots' ? <Shots /> : <Style />}
      </div>
    </div>
  );
}

function MediaList() {
  const project = useStore((s) => s.project)!;
  const name = useStore((s) => s.name)!;
  const jobs = useStore((s) => s.jobs);
  const { ops, notify } = useStore.getState();
  const [query, setQuery] = useState('');
  const [rangeMedia, setRangeMedia] = useState<Media>();
  const picker = useRef<HTMLInputElement>(null);

  const running = Object.values(jobs).filter((j) => j.kind === 'analyze' && (j.status === 'running' || j.status === 'queued'));
  const jobFor = (m: Media): Job | undefined => running.find((j) => j.mediaId ? j.mediaId === m.id : j.label.endsWith(m.name));

  const folder = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<Media>();
  const [menu, setMenu] = useState<{ media: Media; x: number; y: number }>();
  const { ids: selected, id: anchor, confirm } = useMediaSelection();
  const items = project.media.filter((m) => m.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // forget picks that were removed (undo, another tab, Claude)
  useEffect(() => { if (selected.some((id) => !project.media.some((m) => m.id === id))) useMediaSelection.setState({ ids: selected.filter((id) => project.media.some((m) => m.id === id)) }); }, [project.media, selected]);
  const pick = (m: Media, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey && anchor) {
      const a = items.findIndex((x) => x.id === anchor), b = items.findIndex((x) => x.id === m.id);
      if (a >= 0 && b >= 0) return useMediaSelection.setState({ ids: items.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id) });
    }
    if (e.ctrlKey || e.metaKey) return useMediaSelection.setState({ id: m.id, ids: selected.includes(m.id) ? selected.filter((id) => id !== m.id) : [...selected, m.id] });
    selectMedia(m.id);
  };
  const menuFor = (m: Media) => {
    const ids = selected.includes(m.id) ? selected : [m.id], many = ids.length > 1;
    return [
      [
        { label: many ? `أضف ${ids.length} ملفات عند المؤشر` : 'أضف عند المؤشر', key: 'addMedia' as const, run: () => placeMediaRun(ids, useStore.getState().time) },
        ...(!many && m.kind === 'video' ? [{ label: 'معاينة واختيار جزء', run: () => { useStore.getState().setPlaying(false); setRangeMedia(m); } }] : []),
        ...(!many && m.kind === 'video' && m.hasAudio ? [{ label: 'أضف الصوت فقط', run: () => placeMedia(m.id, { at: useStore.getState().time, soundOnly: true }) }] : []),
      ],
      many ? [] : [{ label: 'الاسم والدور والتحليل…', run: () => setOptions(m) }],
      [{ label: many ? `حذف ${ids.length} ملفات من المشروع` : 'حذف من المشروع', key: 'delete' as const, danger: true, run: () => removeMedia(ids) }],
    ];
  };
  const used = (confirm ?? []).reduce((n, id) => n + project.clips.filter((c) => c.mediaId === id).length, 0);
  return (
    <div className="p-3" data-media-list onClick={(e) => { if (e.target === e.currentTarget) selectMedia(); }}>
      <div className="mb-1 flex gap-1">
        <button type="button" data-guide="import" onClick={() => picker.current?.click()} className="media-dropzone btn flex-1 justify-center gap-2 text-xs" title="فيديو أو صوت أو صور — تنضاف لمكتبة المشروع، ثم اسحبها للتايملاين"><Icon name="upload" />استيراد ملفات</button>
        <button type="button" onClick={() => folder.current?.click()} className="btn justify-center gap-2 text-xs" title="كل الفيديو والصوت والصور داخل مجلد">استيراد مجلد</button>
      </div>
      <p className="mb-2 text-center text-[10px] text-ink-500">أو اسحب الملفات هنا · تنضاف للمكتبة، وتحطها بسحبها للتايملاين</p>
      <input ref={picker} type="file" multiple className="hidden" accept="video/*,audio/*,image/*" onChange={(e) => { importFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <input ref={folder} type="file" multiple className="hidden" {...{ webkitdirectory: '' }} onChange={(e) => { const files = [...(e.target.files ?? [])].filter((f) => /^(video|audio|image)\//.test(f.type)); if (files.length) importFiles(files); else notify('ما فيه فيديو أو صوت أو صور في هذا المجلد'); e.target.value = ''; }} />
      <Uploads />
      {!!project.media.length && <div className="search-field mb-3"><Icon name="search" /><input aria-label="البحث في الوسائط" placeholder="ابحث في ملفات المشروع" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button aria-label="مسح بحث الوسائط" onClick={() => setQuery('')}><Icon name="close" /></button>}</div>}
      {query && !items.length && <p className="py-8 text-center text-xs text-ink-400">لا توجد ملفات بهذا الاسم.</p>}
      {selected.length > 1 && <div className="mb-2 flex items-center gap-2 rounded-lg bg-ink-850 px-2 py-1 text-[11px] text-ink-300" role="status"><span className="flex-1">محدد {selected.length} ملفات</span><button className="btn h-6 px-2 text-[11px]" onClick={() => placeMediaRun(selected, useStore.getState().time)}>أضف عند المؤشر</button><button className="btn h-6 px-2 text-[11px] text-cut-text" onClick={() => removeMedia(selected)}>حذف</button><button className="icon-button" aria-label="إلغاء التحديد" onClick={() => selectMedia()}><Icon name="close" /></button></div>}
      <div className="flex flex-col gap-1">
        {items.map((m) => <MediaCard key={m.id} media={m} name={name} selected={selected.includes(m.id)} count={project.clips.filter((c) => c.mediaId === m.id).length} job={jobFor(m)} menuOpen={menu?.media.id === m.id} onPick={(e) => pick(m, e)} onMenu={(x, y, toggle) => setMenu(toggle && menu?.media.id === m.id ? undefined : { media: m, x, y })} onRange={() => { useStore.getState().setPlaying(false); setRangeMedia(m); }} />)}
      </div>
      {menu && <PopupMenu label={`خيارات ${menu.media.name}`} groups={menuFor(menu.media)} x={menu.x} y={menu.y} onClose={() => setMenu(undefined)} />}
      {confirm && <Modal title={confirm.length > 1 ? `حذف ${confirm.length} ملفات؟` : 'حذف الملف؟'} onClose={() => useMediaSelection.setState({ confirm: undefined })} initialFocus="[data-confirm-remove]">
        <div className="modal-body flex flex-col gap-3 text-xs leading-6">
          <p>{used === 1 ? 'مستخدم في مقطع واحد على التايملاين' : `مستخدم في ${used} مقاطع على التايملاين`}، وبينحذف معه. تقدر ترجعه بـ Ctrl+Z.</p>
          <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => useMediaSelection.setState({ confirm: undefined })}>إلغاء</button><button data-confirm-remove className="btn btn-primary" onClick={() => removeMedia(confirm, true)}>حذف</button></div>
        </div>
      </Modal>}
      {options && <Modal title={`خيارات «${options.name}»`} onClose={() => setOptions(undefined)}>
        <div className="modal-body flex flex-col gap-3">
          <form key={options.id} className="flex items-center gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name')?.toString().trim(); if (name && name !== options.name) ops([{ op: 'update_media', mediaId: options.id, patch: { name } }]).then((ok) => ok && setOptions({ ...options, name })); }}>
            اسم الملف<input name="name" className="field flex-1" dir="auto" aria-label="اسم الملف" defaultValue={options.name} maxLength={200} required /><button className="btn" type="submit">حفظ</button>
          </form>
          <label className="flex items-center gap-2 text-xs">دور الملف<select aria-label={`دور ${options.name}`} className="field flex-1" value={options.role} onChange={(e) => { const role = e.target.value as Media['role']; ops([{ op: 'update_media', mediaId: options.id, patch: { role } }]); setOptions({ ...options, role }); }}>{[...ROLES, { id: 'graphic', label: 'رسوم' }, { id: 'sfx', label: 'مؤثر صوتي' }].map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          {options.hasAudio && options.kind !== 'image' && <AudioTracks key={options.id} media={options} name={name} />}
          {options.hasAudio && <TranscribeButton mediaId={options.id} label={options.analyzed.includes('transcribe') ? 'أعد تفريغ الكلام' : 'فرّغ الكلام'} />}
          {options.role === 'ref' && <StyleButton media={options} />}
          {options.kind !== 'image' && <button className="btn btn-ghost" onClick={() => { api.post(`${projectPath(name)}/analyze`, { mediaId: options.id }).catch((e) => notify(e.message)); setOptions(undefined); }}>إعادة التحليل</button>}
        </div>
      </Modal>}
      {rangeMedia && project.media.some((m) => m.id === rangeMedia.id) && <SourceRange key={`${name}:${rangeMedia.id}`} media={rangeMedia} projectId={name} onClose={() => setRangeMedia(undefined)} />}
    </div>
  );
}

function MediaCard({ media: m, name, selected, menuOpen, count, job, onPick, onMenu, onRange }: { media: Media; name: string; selected: boolean; menuOpen: boolean; count: number; job?: Job; onPick(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void; onMenu(x: number, y: number, toggle?: boolean): void; onRange(): void }) {
  const thumbs = useStore((s) => s.analysis[m.id]?.thumbs);
  const [frame, setFrame] = useState(0);
  const per = thumbs ? thumbs.cols * thumbs.rows : 1, j = frame % per;
  const thumb = m.kind === 'image' ? fileUrl(name, m.proxy ?? m.path) : thumbs ? fileUrl(name, `analysis/${m.id}/${thumbs.sheets[Math.floor(frame / per)]}`) : undefined;
  return <div data-media-id={m.id} data-selected={selected || undefined} draggable tabIndex={0} role="group" aria-label={`وسيط ${m.name}`} onClick={(e) => onPick(e)} onContextMenu={(e) => { e.preventDefault(); if (!selected) onPick({ ctrlKey: false, metaKey: false, shiftKey: false }); onMenu(e.clientX, e.clientY); }} onDoubleClick={() => { if (m.kind === 'video') onRange(); }} onDragStart={(e) => { if (!selected) selectMedia(m.id); setDraggingMedia(m.id); e.dataTransfer.setData(MEDIA_DRAG, m.id); e.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => setDraggingMedia()} className={`media-card group relative flex h-14 cursor-grab items-center gap-2 rounded-lg border bg-ink-850 p-1 ${selected ? 'border-accent' : 'border-ink-700 hover:border-ink-500'}`}>
    <div data-media-thumb className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-ink-950" onMouseMove={(e) => { if (thumbs && m.kind === 'video') setFrame(Math.min(thumbs.count - 1, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.clientWidth * thumbs.count))); }} onMouseLeave={() => setFrame(0)} style={thumb ? { backgroundImage: `url("${thumb}")`, backgroundSize: m.kind === 'image' ? 'cover' : `${thumbs!.cols * 100}% ${thumbs!.rows * 100}%`, backgroundPosition: m.kind === 'image' ? 'center' : `${j % thumbs!.cols / Math.max(1, thumbs!.cols - 1) * 100}% ${Math.floor(j / thumbs!.cols) / Math.max(1, thumbs!.rows - 1) * 100}%` } : undefined}>
      {!thumb && <span className="flex h-full items-center justify-center text-ink-400">{m.kind === 'audio' ? '♪' : '▷'}</span>}
      {m.kind !== 'image' && <span className="num absolute bottom-0 end-0 rounded bg-ink-950/85 px-1 text-[10px] text-ink-200">{fmtTime(m.duration, 0)}</span>}
    </div>
    <div className="min-w-0 flex-1"><div className="truncate text-xs text-ink-200" dir="auto" title={m.name}>{m.name}</div><div className="mt-1 flex items-center gap-1 text-[10px] text-ink-400"><span>{m.kind === 'audio' ? '♪ صوت' : m.kind === 'image' ? '▧ صورة' : '▷ فيديو'}</span><span>·</span><span>{count ? `على التايملاين ×${count}` : 'اسحب إلى التايملاين'}</span></div>{job && <div title={`${stageLabel(job.stage)} ${Math.round(job.progress * 100)}%`} className="mt-1 h-0.5 bg-ink-700"><div className="h-full bg-accent" style={{ width: `${job.progress * 100}%` }} /></div>}</div>
    <button className="media-add rounded px-1 text-xs text-accent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" aria-label={`إضافة ${m.name} عند المؤشر`} title="+ عند المؤشر (Shift+A)" onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); placeMedia(m.id, { at: useStore.getState().time }); }}>＋</button>
    <button className="px-1 text-ink-300" aria-label={`خيارات ${m.name}`} aria-haspopup="menu" aria-expanded={menuOpen} onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onMenu(r.left, r.bottom + 2, true); }}>⋯</button>
  </div>;
}

/**
 * A recording with several audio tracks (mic, desktop, music…): which ones play. The file's first track is their mix
 * (what the preview, waveform and export hear); the originals stay in the file, so this can change any time.
 */
function AudioTracks({ media, name }: { media: Media; name: string }) {
  const notify = useStore((s) => s.notify);
  const busy = useStore((s) => Object.values(s.jobs).some((j) => j.mediaId === media.id && (j.status === 'queued' || j.status === 'running')));
  const [info, setInfo] = useState<{ tracks: { channels: number; title?: string; language?: string }[]; mix: number[]; mixed: boolean }>();
  const [pick, setPick] = useState<number[]>([]);
  useEffect(() => {
    api.get<NonNullable<typeof info>>(`${projectPath(name)}/media/${media.id}/audio-tracks`).then((r) => { setInfo(r); setPick(r.mixed ? r.mix : r.tracks.map((_, i) => i)); }).catch(() => setInfo(undefined));
  }, [name, media.id, busy]);
  if (!info || info.tracks.length < 2) return null;
  const same = info.mixed && pick.length === info.mix.length && pick.every((i) => info.mix.includes(i));
  return (
    <fieldset className="flex flex-col gap-1 rounded-lg border border-ink-700 p-2 text-xs" aria-label="مسارات الصوت">
      <legend className="px-1 text-ink-300">مسارات الصوت ({info.tracks.length})</legend>
      <p className="text-[11px] leading-5 text-ink-400">{info.mixed ? 'اللي عليه علامة ينسمع في المعاينة والتصدير.' : 'الملف فيه أكثر من مسار صوت، والحين ينسمع الأول بس. اختر اللي تبيه وطبّق.'} لو المسار الأول فيه كل الأصوات مدموجة من قبل، اختره لحاله عشان ما يتكرر الصوت.</p>
      {info.tracks.map((t, i) => (
        <label key={i} className="flex items-center gap-2">
          <input type="checkbox" checked={pick.includes(i)} onChange={(e) => setPick(e.target.checked ? [...pick, i].sort((a, b) => a - b) : pick.filter((x) => x !== i))} />
          <span>المسار {i + 1}</span>
          {(t.title || t.language) && <span className="truncate text-ink-500" dir="auto">{[t.title, t.language].filter(Boolean).join(' · ')}</span>}
          <span className="ms-auto text-ink-500">{t.channels === 1 ? 'أحادي' : t.channels === 2 ? 'ستيريو' : `${t.channels} قنوات`}</span>
        </label>
      ))}
      <button className="btn mt-1" disabled={busy || same} onClick={() => api.post(`${projectPath(name)}/media/${media.id}/audio-tracks`, { mix: pick }).then(() => notify('يدمج مسارات الصوت… بعدها تتجدد المعاينة والموجة', 'info')).catch((e) => notify(e.message))}>
        {busy ? 'يجهّز…' : pick.length ? `طبّق — ${pick.length === info.tracks.length ? 'كل المسارات' : `${pick.length} من ${info.tracks.length}`}` : 'طبّق — بدون صوت'}
      </button>
    </fieldset>
  );
}

function stageLabel(s?: string) {
  return ({ audio: 'دمج مسارات الصوت', probe: 'فحص', proxy: 'تجهيز البروكسي', peaks: 'موجة الصوت', thumbs: 'صور مصغرة', transcribe: 'تفريغ الكلام', silence: 'فحص السكتات', shots: 'اللقطات', summary: 'ملخص', style: 'الستايل' } as Record<string, string>)[s ?? ''] ?? 'بالانتظار';
}

function StyleButton({ media }: { media: Media }) {
  const name = useStore((s) => s.name)!;
  const notify = useStore((s) => s.notify);
  return (
    <button className="btn h-6 px-2 text-[11px] text-accent" onClick={() =>
      api.post(`${projectPath(name)}/style`, { refMediaId: media.id, strength: 0.6, apply: 'default' }).then(() => notify('يبني الستايل من الرفرنس…', 'info')).catch((e) => notify(e.message))
    }>✦ طابق الستايل</button>
  );
}

/** The edit as ordered shot cards: drag to reorder, click to jump. */
function Shots() {
  const project = useStore((s) => s.project)!;
  const name = useStore((s) => s.name)!;
  const analysis = useStore((s) => s.analysis);
  const selected = useStore((s) => s.selected);
  const { ops, seek, select } = useStore.getState();
  const [dragId, setDragId] = useState<string>();
  const [overIdx, setOverIdx] = useState<number>();
  const clips = mainClips(project).filter((c) => !c.gap);

  if (!clips.length) return <div className="p-6 text-center text-ink-500">ما فيه لقطات بعد.</div>;
  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {clips.map((c, i) => (
        <div
          key={c.id}
          draggable
          onDragStart={() => setDragId(c.id)}
          onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
          onDragEnd={() => { setDragId(undefined); setOverIdx(undefined); }}
          onDrop={() => {
            if (dragId && dragId !== c.id) ops([{ op: 'reorder', clipId: dragId, index: i }]);
            setDragId(undefined);
            setOverIdx(undefined);
          }}
          onClick={() => { select([c.id]); seek(c.start); }}
          className={`cursor-pointer overflow-hidden rounded-lg border bg-ink-850 transition-all ${selected.includes(c.id) ? 'border-accent' : 'border-ink-700 hover:border-ink-500'} ${overIdx === i && dragId !== c.id ? 'ring-2 ring-accent/60' : ''} ${dragId === c.id ? 'opacity-40' : ''}`}
        >
          <ClipThumb clip={c} name={name} thumbs={analysis[c.mediaId ?? '']?.thumbs} />
          <div className="flex items-center gap-1 px-2 py-1 text-[11px]">
            <span className="num text-ink-500">{i + 1}</span>
            <span className="flex-1 truncate text-ink-300">{c.label ?? fmtTime(c.in, 0)}</span>
            {c.speed !== 1 && <span className="rounded bg-accent px-1 text-[10px] text-black">×{c.speed}</span>}
            <span className="num text-ink-400">{clipDuration(c).toFixed(1)}s</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClipThumb({ clip, name, thumbs }: { clip: Clip; name: string; thumbs?: { interval: number; w: number; h: number; cols: number; rows: number; count: number; sheets: string[] } }) {
  if (!thumbs) return <div className="aspect-video bg-ink-950" />;
  const k = Math.min(thumbs.count - 1, Math.round((clip.in + Math.min(1, (clip.out - clip.in) / 2)) / thumbs.interval));
  const per = thumbs.cols * thumbs.rows;
  const sheet = thumbs.sheets[Math.floor(k / per)];
  const j = k % per;
  return (
    <div className="aspect-video bg-ink-950" style={{
      backgroundImage: sheet ? `url("${fileUrl(name, `analysis/${clip.mediaId}/${sheet}`)}")` : undefined,
      backgroundSize: `${thumbs.cols * 100}% ${thumbs.rows * 100}%`,
      backgroundPosition: `${((j % thumbs.cols) / (thumbs.cols - 1)) * 100}% ${(Math.floor(j / thumbs.cols) / (thumbs.rows - 1)) * 100}%`,
    }} />
  );
}

interface StyleJson {
  name: string; look: string; palette: { hex: string; share: number }[]; lut?: string; styleframe?: string; strength: number;
  color: { mean: number[]; std: number[]; chroma: number; warmth: number };
  rhythm?: { cuts_per_min: number; avg_shot: number; median_shot: number } | null;
}

function Style() {
  const project = useStore((s) => s.project)!;
  const name = useStore((s) => s.name)!;
  const jobs = useStore((s) => s.jobs);
  const { ops, notify } = useStore.getState();
  const [style, setStyle] = useState<StyleJson>();
  const refs = project.media.filter((m) => m.role === 'ref');
  const running = Object.values(jobs).find((j) => j.kind === 'style' && (j.status === 'running' || j.status === 'queued'));

  useEffect(() => {
    if (!project.style) return setStyle(undefined);
    api.get<StyleJson>(fileUrl(name, project.style)! + `?v=${Date.now()}`).then(setStyle).catch(() => setStyle(undefined));
  }, [project.style, name, running?.status]);

  return (
    <div className="p-3">
      <button className="btn btn-primary mb-3 w-full justify-center" onClick={() => useStore.getState().setStylesOpen(true)}><Icon name="palette" /> افتح مكتبة الستايلات</button>
      {!refs.length && <p className="mb-3 text-xs leading-6 text-ink-400">ارفع رفرنس (مقطع أو صورة) ثم غيّر دوره إلى «رفرنس» من بطاقة الملف، ثم اضغط «طابق الستايل». الأداة تقيس الألوان والإضاءة والإيقاع وتبني LUT يقرّب مقطعك منه.</p>}
      {refs.map((r) => (
        <div key={r.id} className="mb-2 flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 p-2">
          <span className="flex-1 truncate" dir="auto">{r.name}</span>
          <StyleButton media={r} />
        </div>
      ))}
      {running && <div className="my-2 text-xs text-accent">يبني الستايل… {Math.round(running.progress * 100)}%</div>}
      {style && (
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-850 p-3">
          <div className="mb-1 font-semibold">{style.name}</div>
          <div className="mb-2 text-xs text-ink-400">{style.look}</div>
          <div className="mb-3 flex h-6 overflow-hidden rounded">
            {style.palette.map((p) => <div key={p.hex} title={`${p.hex} · ${Math.round(p.share * 100)}%`} style={{ background: p.hex, flex: p.share }} />)}
          </div>
          {style.styleframe && (
            <figure className="mb-3">
              <img src={fileUrl(name, style.styleframe) + `?v=${project.style}`} className="w-full rounded" />
              <figcaption className="mt-1 flex justify-between text-[10px] text-ink-500"><span>الرفرنس</span><span>بعد الـLUT</span><span>مقطعك</span></figcaption>
            </figure>
          )}
          <dl className="grid grid-cols-2 gap-y-1 text-[11px] text-ink-400">
            <dt>الإضاءة</dt><dd className="num">{style.color.mean[0].toFixed(0)}</dd>
            <dt>التباين</dt><dd className="num">{style.color.std[0].toFixed(1)}</dd>
            <dt>التشبع</dt><dd className="num">{style.color.chroma}</dd>
            {style.rhythm && <><dt>الإيقاع</dt><dd className="num">{style.rhythm.cuts_per_min} قطع/د · {style.rhythm.avg_shot}ث</dd></>}
          </dl>
          {style.lut && (
            <div className="mt-3 flex gap-1">
              <button className="btn h-7 flex-1 justify-center text-xs" onClick={() => ops([{ op: 'set_grade', asDefault: true, grade: { lut: style.lut, lutMix: 0.6 } }])}>طبّق على المشروع</button>
              <button className="btn btn-ghost h-7 text-xs" onClick={() => ops([{ op: 'set_settings', patch: { defaultGrade: null } }]).then(() => notify('رجعت الألوان الأصلية', 'info'))}>إلغاء</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
