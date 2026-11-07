import { useEffect, useRef, useState } from 'react';
import { clipDuration, clipEnd, fmtTime, graphicBaseSize, graphicPageDuration, graphicUrl, mainClips, makeId, pageToRetimed, type Clip, type GraphicEdit, type Op, type Project, type Transition } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { currentMotion, graphicElement, MOTIONS, motionPatch, withEdit, type Motion } from '../lib/graphic-edit.ts';
import { KeySlider, Row, Section, Slider } from './ui.tsx';
import { Icon } from './Brand.tsx';

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Editing what Claude placed: timing of any clip off the main track, and for HTML graphics their
// content (graphicData, as a form built from the data itself), their scenes' lengths, any element
// inside the page (picked on the preview) and their place on the frame.

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
interface Template {
  graphic: string; /** short Arabic name */ name?: string; description?: string; /** what it is, for the user (description is written for Claude) */ about?: string; duration?: number; data?: Record<string, Json>; options?: Record<string, string[]>;
  /** names to show for the data fields */
  labels?: Record<string, string>;
  /** a project graphic takes its colours (themed) / its font (themedFont) from the project identity; false = written into the page */
  themed?: boolean;
  themedFont?: boolean;
  /** where the page's scenes start (page seconds), so each can be played longer or shorter */
  scenes?: Scene[];
}

const templates = new Map<string, Promise<{ library: Template[]; own: Template[] }>>();
/** The library templates and the project's own graphics (with their template.json, if any). */
export function useTemplates(project: string, fresh = false): { library: Template[]; own: Template[] } {
  const [list, setList] = useState<{ library: Template[]; own: Template[] }>({ library: [], own: [] });
  useEffect(() => {
    let p = fresh ? undefined : templates.get(project);
    if (!p) {
      p = api.get<{ library: Template[]; own?: Template[] }>(`${projectPath(project)}/graphics`).then((r) => ({ library: r.library, own: r.own ?? [] })).catch(() => ({ library: [], own: [] }));
      templates.set(project, p);
    }
    p.then(setList);
  }, [project, fresh]);
  return list;
}
export function useTemplate(project: string, graphic?: string): Template | undefined {
  const { library, own } = useTemplates(project);
  return [...library, ...own].find((t) => t.graphic === graphic?.replace(/\/+$/, ''));
}

/** Toolbar menu: put a library template (or one of the project's graphics) at the playhead, then edit it in the inspector. */
export function GraphicPicker() {
  const name = useStore((s) => s.name)!;
  // fixed, above the button: the toolbar scrolls sideways and would clip an absolute menu
  const [open, setOpen] = useState<{ right: number; bottom: number }>();
  const { library, own } = useTemplates(name, !!open);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(undefined); };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [open]);
  const place = async (t: Template) => {
    setOpen(undefined);
    const { ops, select, time, setPanel, project } = useStore.getState();
    const id = makeId('c');
    const duration = t.duration ?? 4;
    const free = project?.tracks.find((tr) => tr.kind === 'overlay' && !project.clips.some((c) => c.trackId === tr.id && c.start < time + duration && clipEnd(c) > time));
    const trackId = free?.id ?? makeId('V');
    const edits: Op[] = free ? [] : [{ op: 'add_track', track: { id: trackId, kind: 'overlay', name: 'رسوم' } }];
    edits.push({ op: 'add_clip', clip: { id, trackId, graphic: t.graphic, ...(t.data ? { graphicData: t.data } : {}), in: 0, out: duration, start: time } });
    if (await ops(edits)) {
      select([id]);
      setPanel('inspect');
    }
  };
  const item = (t: Template) => (
    <button key={t.graphic} className="block w-full rounded-md px-2 py-1.5 text-start hover:bg-ink-800" onClick={() => place(t)}>
      <div className="text-xs text-ink-100">{t.name ?? t.graphic.replace(/^lib\//, '')}{t.duration ? <span className="num mr-2 text-ink-500">{t.duration}ث</span> : null}</div>
      {t.about && <div className="mt-0.5 text-[11px] leading-4 text-ink-500">{t.about}</div>}
    </button>
  );
  return (
    <div ref={box} className="relative">
      <button className="btn btn-ghost timeline-tool" title="إضافة رسمة جاهزة عند المؤشر" aria-label="إضافة رسمة" aria-expanded={!!open} onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setOpen(open ? undefined : { right: innerWidth - r.right, bottom: innerHeight - r.top + 4 });
      }}><Icon name="shapes" size={16} /><span>رسمة</span></button>
      {open && (
        <div className="fixed z-50 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-xl" style={open}>
          <div className="px-2 py-1 text-[11px] text-ink-500">تنحط عند المؤشر، وتعدّل كلامها ومشاهدها من «الخصائص».</div>
          {library.map(item)}
          {own.length > 0 && <div className="mt-1 border-t border-ink-800 px-2 pt-2 text-[11px] text-ink-500">رسومات المشروع</div>}
          {own.map(item)}
        </div>
      )}
    </div>
  );
}

// Scenes a page works out for itself (library templates: from their data and length) are read from
// window.__graphicScenes after loading it once, hidden; a template.json `scenes` list wins.
const pageScenes = new Map<string, Promise<Scene[] | undefined>>();
function readPageScenes(url: string): Promise<Scene[] | undefined> {
  let p = pageScenes.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
      let timer = 0;
      const done = (v?: Scene[]) => { clearTimeout(timer); f.remove(); resolve(v); };
      f.onload = () => {
        try { const s = (f.contentWindow as { __graphicScenes?: unknown } | null)?.__graphicScenes; done(Array.isArray(s) ? (s as Scene[]) : undefined); } catch { done(); }
      };
      timer = window.setTimeout(() => done(), 10000);
      f.src = url;
      document.body.append(f);
    });
    pageScenes.set(url, p);
  }
  return p;
}

/** The scenes of a graphic clip's page, as authored (page seconds). */
export function useScenes(clip: Clip): Scene[] | undefined {
  const name = useStore((s) => s.name)!;
  const settings = useStore((s) => s.project!.settings);
  const tpl = useTemplate(name, clip.graphic);
  const url = clip.graphic && !tpl?.scenes ? graphicUrl(name, { ...clip, graphicEdits: undefined }, graphicBaseSize(settings), settings.theme, { edits: false }) : undefined;
  const [read, setRead] = useState<{ url: string; scenes?: Scene[] }>();
  useEffect(() => {
    if (url) readPageScenes(url).then((scenes) => setRead({ url, scenes }));
  }, [url]);
  return tpl?.scenes ?? (url && read?.url === url ? read.scenes : undefined);
}

/** A number field that saves on Enter / blur. */
function NumberField({ value, onCommit, step = 0.1, min = 0 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(Math.round(value * 1000) / 1000)), [value]);
  const save = () => { const n = Number(v); if (Number.isFinite(n) && n >= min && Math.abs(n - value) > 1e-4) onCommit(n); else setV(String(value)); };
  return (
    <input className="field num" type="number" step={step} min={min} value={v} dir="ltr"
      onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

/** Start and length of a clip off the main track (text, graphic, b-roll, music). */
export function TimingSection({ clip }: { clip: Clip }) {
  const { ops } = useStore.getState();
  const time = useStore((s) => s.time);
  const dur = clipDuration(clip);
  const timing = (patch: { start?: number; duration?: number }) => ops([{ op: 'set_timing', clipId: clip.id, ...patch }]);
  return (
    <Section title="الوقت">
      <Row label="البداية"><NumberField value={clip.start} onCommit={(start) => timing({ start })} /></Row>
      <Row label="المدة"><NumberField value={dur} onCommit={(duration) => timing({ duration })} /></Row>
      <div className="mt-1 flex gap-2">
        <button className="btn h-7 flex-1 justify-center text-xs" onClick={() => timing({ start: time })}>تبدأ عند المؤشر</button>
        <button className="btn h-7 flex-1 justify-center text-xs" disabled={time <= clip.start + 0.1} onClick={() => timing({ duration: time - clip.start })}>تنتهي عند المؤشر</button>
      </div>
      <div className="mt-1 text-[11px] text-ink-500 num" dir="ltr">{fmtTime(clip.start, 2)} → {fmtTime(clip.start + dur, 2)}</div>
    </Section>
  );
}

export const TRANSITIONS: Record<Transition['kind'], string> = {
  crossfade: 'مزج', dip: 'سواد', flash: 'فلاش أبيض', slide: 'سحب', zoom: 'زوم', blur: 'ضبابية', wipe: 'مسح',
};

/** How a main-track clip comes in from the clip before it. */
export function TransitionSection({ clip, project }: { clip: Clip; project: Project }) {
  const { ops, commit, preview } = useStore.getState();
  const main = mainClips(project);
  const i = main.findIndex((c) => c.id === clip.id);
  if (i < 0) return null;
  const tr = clip.transition;
  const set = (kind: Transition['kind'] | null, duration?: number, ids = [clip.id]) => ops([{ op: 'set_transition', clipIds: ids, kind, duration }]);
  const dur = (v: number, c: boolean) => {
    const o: Op[] = [{ op: 'set_transition', clipIds: [clip.id], kind: tr!.kind, duration: v }];
    return c ? commit(o) : preview(o);
  };
  return (
    <Section title="الانتقال من اللقطة اللي قبل" actions={tr && i > 0 && (
      <button className="btn btn-ghost h-6 text-xs" title="نفس الانتقال على كل القصات" onClick={() => set(tr.kind, tr.duration, main.slice(1).map((c) => c.id))}>للكل</button>
    )}>
      {i === 0 ? <div className="text-xs text-ink-500">هذي أول لقطة — ما قبلها شي.</div> : (
        <>
          <div className="mb-2 grid grid-cols-4 gap-1">
            <button className={`btn h-7 justify-center px-1 text-[11px] ${!tr ? 'border-accent bg-accent/15 text-accent' : ''}`} onClick={() => set(null)}>قص</button>
            {(Object.keys(TRANSITIONS) as Transition['kind'][]).map((k) => (
              <button key={k} className={`btn h-7 justify-center px-1 text-[11px] ${tr?.kind === k ? 'border-accent bg-accent/15 text-accent' : ''}`} onClick={() => set(k)}>{TRANSITIONS[k]}</button>
            ))}
          </div>
          {tr && <Row label="المدة"><Slider value={tr.duration} min={0.1} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)}ث`} onPreview={(v) => dur(v, false)} onCommit={(v) => dur(v, true)} /></Row>}
          {tr && <div className="text-[11px] text-ink-500">نص المدة قبل القص ونصها بعده — طول المقطع ما يتغيّر.</div>}
        </>
      )}
    </Section>
  );
}

/** What the graphic says: its template's fields, its scenes, and hand edits of its elements. */
export function GraphicContent({ clip }: { clip: Clip }) {
  const name = useStore((s) => s.name)!;
  const tpl = useTemplate(name, clip.graphic);
  const scenes = useScenes(clip);
  const { ops } = useStore.getState();
  const data = (clip.graphicData ?? {}) as Record<string, Json>;
  const setData = (next: Record<string, Json>) => ops([{ op: 'update_clip', clipId: clip.id, patch: { graphicData: next } }]);
  // fields the template knows about come first, in its order; then anything else on the clip
  const keys = [...new Set([...Object.keys(tpl?.data ?? {}), ...Object.keys(data)])];

  return (
    <>
      <Section title="المحتوى">
        {(tpl?.about ?? tpl?.description) && <div className="mb-2 text-[11px] leading-5 text-ink-500" dir="auto">{tpl!.about ?? tpl!.description}</div>}
        {keys.length ? keys.map((k) => (
          <Field key={k} name={k} label={tpl?.labels?.[k]} value={data[k]} example={tpl?.data?.[k]} options={tpl?.options?.[k]}
            onChange={(v) => {
              const next = { ...data };
              if (v === undefined) delete next[k]; else next[k] = v;
              setData(next);
            }} />
        )) : <div className="text-xs text-ink-500">هذي الرسمة ما لها بيانات — عدّل عناصرها مباشرة من «عناصر الرسمة».</div>}
      </Section>
      {!!scenes?.length && <ScenesSection clip={clip} scenes={scenes} />}
      <ElementsSection clip={clip} />
    </>
  );
}

/** Where the graphic sits on the frame (keyable), and how it comes in and goes out. */
export function GraphicPlace({ clip }: { clip: Clip }) {
  const { ops } = useStore.getState();
  return (
    <>
      <Section title="المكان والحجم" actions={(clip.place || clip.anim || clip.picture) && <button className="btn btn-ghost h-6 text-xs" onClick={() => ops([{ op: 'update_clip', clipId: clip.id, patch: { place: null, picture: null, anim: null } }])}>إعادة</button>}>
        <Row label="أفقي"><KeySlider clip={clip} prop="dx" min={-0.5} max={0.5} step={0.005} def={0} fmt={pct} /></Row>
        <Row label="عمودي"><KeySlider clip={clip} prop="dy" min={-0.5} max={0.5} step={0.005} def={0} fmt={pct} /></Row>
        <Row label="الحجم"><KeySlider clip={clip} prop="scale" min={0.2} max={2} step={0.01} def={1} fmt={pct} /></Row>
        <Row label="الشفافية"><KeySlider clip={clip} prop="opacity" min={0} max={1} step={0.01} def={1} fmt={pct} /></Row>
        <div className="text-[11px] text-ink-500">أو اسحب الرسمة على الفيديو، والزاوية للحجم. ◆ مفتاح حركة عند المؤشر: مفتاحين بقيم مختلفة وتتحرك بينهم.</div>
      </Section>
      <MotionSection clip={clip} />
    </>
  );
}

/** The pieces that play one page together (a graphic split on the timeline). */
function pieces(project: Project, clip: Clip): string[] {
  const same = (c: Clip) => c.graphic === clip.graphic && c.trackId === clip.trackId
    && JSON.stringify(c.graphicData ?? null) === JSON.stringify(clip.graphicData ?? null) && JSON.stringify(c.retime ?? null) === JSON.stringify(clip.retime ?? null);
  return project.clips.filter(same).map((c) => c.id);
}

export type Scene = { name: string; start: number };

/**
 * A graphic's scenes as edges: `from` in page seconds (as authored, ending at the page end), `now` in
 * the clip's clock, and the op that gives scene i the length `len` (the scenes after it follow).
 */
export function sceneEdges(project: Project, clip: Clip, scenes: Scene[]) {
  const end = graphicPageDuration(clip);
  const list = scenes.filter((s) => s.start >= 0 && s.start < end - 0.05).sort((a, b) => a.start - b.start);
  if (!list.length) return undefined;
  if (list[0].start > 0.05) list.unshift({ name: 'البداية', start: 0 });
  else list[0] = { ...list[0], start: 0 };
  const from = [...list.map((s) => s.start), end];
  const now = from.map((t) => pageToRetimed(clip.retime, t));
  const ids = pieces(project, clip);
  const opsFor = (i: number, len: number): Op[] => {
    const to = [now[0]];
    for (let j = 0; j < list.length; j++) to.push(to[j] + (j === i ? len : now[j + 1] - now[j]));
    const asAuthored = to.every((t, j) => Math.abs(t - from[j]) < 1e-3);
    // hold: a longer scene keeps its motion at normal speed and stays on its last frame
    return [{ op: 'retime_graphic', clipIds: ids, from, to: asAuthored ? null : to.map((t) => Math.round(t * 1000) / 1000), hold: true }];
  };
  return { list, from, now, ids, opsFor };
}

/** Each scene of the page played longer or shorter (retime_graphic); the rest of the graphic follows. */
function ScenesSection({ clip, scenes }: { clip: Clip; scenes: Scene[] }) {
  const project = useStore((s) => s.project)!;
  const { preview, commit, ops, seek } = useStore.getState();
  const edges = sceneEdges(project, clip, scenes);
  if (!edges) return null;
  const { list, from, now, ids, opsFor } = edges;
  return (
    <Section title="المشاهد" actions={clip.retime && <button className="btn btn-ghost h-6 text-xs" onClick={() => ops([{ op: 'retime_graphic', clipIds: ids, from, to: null }])}>إعادة</button>}>
      {list.map((s, i) => {
        const authored = from[i + 1] - from[i];
        return (
          <div key={i} className="grid grid-cols-[88px_1fr] items-center gap-2 py-1">
            <button className="truncate text-start text-xs text-ink-400 hover:text-accent" title="روح لهذا المشهد" onClick={() => seek(clip.start + (now[i] - clip.in) / clip.speed + 0.05)}>{s.name}</button>
            <Slider value={now[i + 1] - now[i]} min={0.1} max={Math.max(4, authored * 3)} step={0.05} def={authored} fmt={(v) => `${v.toFixed(2)}ث`}
              onPreview={(v) => preview(opsFor(i, v))} onCommit={(v) => commit(opsFor(i, v))} />
          </div>
        );
      })}
      <div className="text-[11px] text-ink-500">طوّل أي مشهد: حركته تمشي بسرعتها وبعدين يثبت. قصّره: يسرع. اللي بعده يمشي معه، والرسمة ما تنعاد.</div>
    </Section>
  );
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
/** '#rrggbb' of a computed CSS colour ('rgb(…)' / 'rgba(…)'); undefined when it is not one. */
function cssHex(c?: string): string | undefined {
  const m = c?.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (m?.[4] !== undefined && Number(m[4]) === 0) return undefined; // transparent: no colour to show
  return m ?`#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}` : /^#[0-9a-f]{6}$/i.test(c ?? '') ? c : undefined;
}

/** A colour swatch with its hex code; both commit. */
function ColorField({ value, onCommit, placeholder }: { value?: string; onCommit: (v: string | undefined) => void; placeholder?: string }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <div className="flex items-center gap-1">
      <input type="color" className="h-7 w-8 shrink-0 cursor-pointer rounded border border-ink-700 bg-transparent p-0" value={cssHex(v) ?? cssHex(placeholder) ?? '#ffffff'}
        onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value ?? '') && onCommit(v || undefined)} />
      <input className="field num min-w-0 flex-1" dir="ltr" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (value ?? '') && onCommit(v || undefined)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

/** Any element inside the page, picked on the preview: its text, colours, visibility, place and size. */
function ElementsSection({ clip }: { clip: Clip }) {
  const pick = useStore((s) => s.graphicPick);
  const time = useStore((s) => s.time);
  const { setGraphicPick, ops, preview, commit, seek } = useStore.getState();
  const picking = pick?.clipId === clip.id;
  const edits = clip.graphicEdits ?? [];
  const target = picking ? pick.target : undefined;
  const cur = edits.find((e) => e.target === target);
  const el = target ? graphicElement(clip.id, target) : null;
  const view = el?.ownerDocument.defaultView as (Window & { __graphicPath?: (e: Element) => string }) | null | undefined;
  const cs = el && view ? view.getComputedStyle(el) : undefined;
  const svg = el?.namespaceURI === 'http://www.w3.org/2000/svg'; // the page's own realm: instanceof would not match
  const visible = time >= clip.start && time < clipEnd(clip);
  const editOps = (patch: Partial<GraphicEdit> | null, list = edits, t = target!): Op[] => [{ op: 'update_clip', clipId: clip.id, patch: { graphicEdits: withEdit(list, t, patch && { label: pick?.label, ...patch }) } }];
  const start = () => {
    if (!visible) seek(clip.start + Math.min(1, clipDuration(clip) / 2));
    setGraphicPick({ clipId: clip.id });
  };
  const parent = () => {
    const up = el?.parentElement;
    if (!up || up.localName === 'body' || !view?.__graphicPath) return;
    setGraphicPick({ clipId: clip.id, target: view.__graphicPath(up), label: (up.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || up.localName });
  };

  return (
    <Section title="عناصر الرسمة" actions={edits.length > 0 && <button className="btn btn-ghost h-6 text-xs" onClick={() => ops([{ op: 'update_clip', clipId: clip.id, patch: { graphicEdits: null } }])}>إعادة الكل</button>}>
      {!picking ? (
        <>
          <button className="btn h-8 w-full justify-center text-xs" onClick={start}>اختر عنصر من الرسمة</button>
          <div className="mt-1 text-[11px] text-ink-500">اضغط على أي نص أو شكل في الفيديو وغيّر كلامه ولونه ومكانه — بدون ما تحتاج الذكاء.</div>
        </>
      ) : !target ? (
        <>
          <div className="text-xs leading-5 text-ink-300">{visible ? 'مرّر على الرسمة في الفيديو واضغط على العنصر. اسحبه لتحريكه.' : 'المؤشر برا الرسمة — حرّكه عليها.'}</div>
          <button className="btn btn-ghost mt-1 h-7 text-xs" onClick={() => setGraphicPick(undefined)}>تم (Esc)</button>
        </>
      ) : (
        <div className="rounded border border-accent/40 px-2 py-1">
          <div className="mb-1 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs text-accent" title={target}>{pick?.label}</span>
            <button className="btn btn-ghost h-6 px-1 text-[11px]" title="اختر اللي يحتويه (البطاقة أو المجموعة)" onClick={parent}>الأكبر ↑</button>
            {cur && <button className="btn btn-ghost h-6 px-1 text-[11px]" onClick={() => ops(editOps(null))}>إعادة</button>}
            <button className="btn btn-ghost h-6 px-1 text-[11px]" onClick={() => setGraphicPick(undefined)}>تم</button>
          </div>
          {!el && <div className="text-[11px] text-ink-500">العنصر مو ظاهر الحين — حرّك المؤشر لوقت يظهر فيه.</div>}
          {(cur?.text !== undefined || (el && !el.children.length && (el.textContent ?? '').trim())) && (
            <Row label="النص"><TextField value={cur?.text ?? el?.textContent ?? ''} onCommit={(s) => ops(editOps({ text: s }))} /></Row>
          )}
          <Row label={svg ? 'التعبئة' : 'لون النص'}><ColorField value={cur?.color} placeholder={cssHex(svg ? (cs?.fill === 'none' ? cs?.stroke : cs?.fill) : cs?.color)} onCommit={(c) => ops(editOps({ color: c }))} /></Row>
          {!svg && <Row label="الخلفية"><ColorField value={cur?.background} placeholder={cssHex(cs?.backgroundColor)} onCommit={(c) => ops(editOps({ background: c }))} /></Row>}
          <Row label="مخفي"><input type="checkbox" checked={!!cur?.hidden} onChange={(e) => ops(editOps({ hidden: e.target.checked }))} /></Row>
          <Row label="الحجم"><Slider value={cur?.scale ?? 1} min={0.2} max={3} step={0.01} def={1} fmt={pct} onPreview={(v) => preview(editOps({ scale: v }))} onCommit={(v) => commit(editOps({ scale: v }))} /></Row>
          <Row label="أفقي (px)"><NumberField value={cur?.dx ?? 0} step={1} min={-1e5} onCommit={(v) => ops(editOps({ dx: v }))} /></Row>
          <Row label="عمودي (px)"><NumberField value={cur?.dy ?? 0} step={1} min={-1e5} onCommit={(v) => ops(editOps({ dy: v }))} /></Row>
        </div>
      )}
      {edits.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-ink-500">معدّل ({edits.length})</div>
          {edits.map((e) => (
            <div key={e.target} className={`flex items-center gap-1 rounded px-1 ${e.target === target ? 'bg-accent/10' : ''}`}>
              <button className="min-w-0 flex-1 truncate py-0.5 text-start text-xs text-ink-300 hover:text-accent" title={e.target} onClick={() => setGraphicPick({ clipId: clip.id, target: e.target, label: e.label })}>{e.label ?? e.target}</button>
              <button className="btn btn-ghost h-6 px-1 text-xs text-cut-text" title="رجّعه مثل ما كان" onClick={() => ops(editOps(null, edits, e.target))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Ready entrance / exit moves for a layer (graphic or b-roll): keys on its place and opacity. */
export function MotionSection({ clip }: { clip: Clip }) {
  const { ops } = useStore.getState();
  const now = currentMotion(clip);
  const set = (enter: Motion, exit: Motion) => ops([{ op: 'update_clip', clipId: clip.id, patch: { anim: motionPatch(clip, enter, exit) } }]);
  const row = (side: 'enter' | 'exit') => (
    <div className="grid grid-cols-5 gap-1">
      {(Object.keys(MOTIONS) as Motion[]).map((m) => (
        <button key={m} className={`btn h-7 justify-center px-1 text-[11px] ${now[side] === m ? 'border-accent bg-accent/15 text-accent' : ''}`}
          onClick={() => (side === 'enter' ? set(m, now.exit ?? 'none') : set(now.enter ?? 'none', m))}>{MOTIONS[m]}</button>
      ))}
    </div>
  );
  return (
    <Section title="حركة الدخول والخروج">
      <div className="mb-1 text-xs text-ink-400">الدخول</div>
      {row('enter')}
      <div className="mb-1 mt-2 text-xs text-ink-400">الخروج</div>
      {row('exit')}
      {!now.enter && !now.exit && clip.anim && <div className="mt-1 text-[11px] text-ink-500">فيها مفاتيح حركة خاصة — اختيار قالب يستبدلها.</div>}
    </Section>
  );
}

const LABELS: Record<string, string> = {
  title: 'العنوان', subtitle: 'تحت العنوان', label: 'النص', steps: 'الخطوات', keys: 'الأزرار', position: 'المكان', shape: 'الشكل',
  sides: 'الجهتين', points: 'النقاط', number: 'الرقم', vs: 'الشارة', dim: 'تعتيم الباقي', accent: 'اللون',
  x: 'أفقي', y: 'عمودي', w: 'العرض', h: 'الارتفاع',
};
const UNIT = new Set(['x', 'y', 'w', 'h']);
const isColor = (v: unknown) => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

/** One editable value of graphicData; arrays and objects recurse. undefined = remove the key. */
/** the words templates use for their choices, as the editor says them */
const OPTION_NAMES: Record<string, string> = {
  start: 'بداية السطر', end: 'نهاية السطر', center: 'الوسط', top: 'فوق', bottom: 'تحت', left: 'يسار', right: 'يمين', box: 'مربع', circle: 'دائرة',
};

function Field({ name, label: shown, value, example, options, onChange }: {
  name: string; label?: string; value: Json | undefined; example?: Json; options?: string[]; onChange: (v: Json | undefined) => void;
}) {
  const label = shown ?? LABELS[name] ?? name;
  const v = value ?? null;
  const kind = Array.isArray(v ?? example) ? 'array' : typeof (v ?? example);

  if (options) {
    return (
      <Row label={label}>
        <select className="field" value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">افتراضي</option>
          {options.map((o) => <option key={o} value={o}>{OPTION_NAMES[o] ?? o}</option>)}
        </select>
      </Row>
    );
  }
  if (kind === 'boolean') return <Row label={label}><input type="checkbox" checked={v === null ? example !== false : !!v} onChange={(e) => onChange(e.target.checked)} /></Row>;
  if (kind === 'number') {
    if (UNIT.has(name)) return <Row label={label}><Slider value={typeof v === 'number' ? v : Number(example ?? 0)} min={0} max={1} step={0.005} onPreview={() => {}} onCommit={(n) => onChange(n)} /></Row>;
    return <Row label={label}><NumberField value={typeof v === 'number' ? v : Number(example ?? 0)} step={1} min={-1e9} onCommit={(n) => onChange(n)} /></Row>;
  }
  if (kind === 'array') {
    const items = (Array.isArray(v) ? v : []) as Json[];
    const sample = (Array.isArray(example) && example[0]) ?? '';
    const set = (i: number, it: Json | undefined) => onChange(it === undefined ? items.filter((_, j) => j !== i) : items.map((x, j) => (j === i ? it : x)));
    const swap = (i: number) => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); };
    return (
      <div className="py-1">
        <div className="mb-1 text-xs text-ink-400">{label}</div>
        {items.map((it, i) => (
          <div key={i} className="mb-1 flex items-start gap-1">
            <span className="num mt-1.5 w-4 text-[10px] text-ink-500">{i + 1}</span>
            <div className="min-w-0 flex-1">
              {typeof it === 'object' && it !== null && !Array.isArray(it)
                ? <Group value={it} example={typeof sample === 'object' ? (sample as Record<string, Json>) : undefined} onChange={(g) => set(i, g)} />
                : <TextField value={String(it ?? '')} onCommit={(s) => set(i, s)} />}
            </div>
            <button className="btn btn-ghost h-7 px-1 text-xs" disabled={i === 0} title="فوق" onClick={() => swap(i)}>↑</button>
            <button className="btn btn-ghost h-7 px-1 text-xs text-cut-text" title="حذف" onClick={() => set(i, undefined)}>✕</button>
          </div>
        ))}
        <button className="btn btn-ghost h-6 text-xs" onClick={() => onChange([...items, typeof sample === 'object' && sample !== null ? structuredClone(sample) : ''])}>+ إضافة</button>
      </div>
    );
  }
  if (kind === 'object' && v !== null && !Array.isArray(v)) {
    return <div className="py-1"><div className="mb-1 text-xs text-ink-400">{label}</div><Group value={v as Record<string, Json>} onChange={onChange} /></div>;
  }
  if (isColor(v) || isColor(example) || /colou?r|accent/i.test(name)) {
    return <Row label={label}><ColorField value={typeof v === 'string' ? v : undefined} placeholder={typeof example === 'string' ? example : undefined} onCommit={(s) => onChange(s)} /></Row>;
  }
  return <Row label={label}><TextField value={v === null ? '' : String(v)} placeholder={example !== undefined ? String(example) : ''} onCommit={(s) => onChange(s === '' ? undefined : s)} /></Row>;
}

function Group({ value, example, onChange }: { value: Record<string, Json>; example?: Record<string, Json>; onChange: (v: Record<string, Json>) => void }) {
  const keys = [...new Set([...Object.keys(example ?? {}), ...Object.keys(value)])];
  return (
    <div className="rounded border border-ink-800 px-2">
      {keys.map((k) => (
        <Field key={k} name={k} value={value[k]} example={example?.[k]} onChange={(v) => {
          const next = { ...value };
          if (v === undefined) delete next[k]; else next[k] = v;
          onChange(next);
        }} />
      ))}
    </div>
  );
}

/** Text that saves on Enter / blur (one undo step per edit, not per keystroke). */
function TextField({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="field w-full" dir="auto" value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value); }} />
  );
}
