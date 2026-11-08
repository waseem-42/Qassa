import { BrandKits } from './BrandKits.tsx';
import { useEffect, useRef, useState } from 'react';
import { captionWordStarts, clipDuration, clipEnd, fmtTime, Grade, MAIN_TRACK, Picture, Place, PLACE_LIMITS, placeAt, TextStyle, textLayerHtml, Theme, THEME_FONTS, transformAt, AUTO_MARK, SFX_TRACK, type Clip, type Op, type Project } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { api, projectPath } from '../lib/api.ts';
import { EaseRow, KeySlider, Row, Section, Slider } from './ui.tsx';
import { playOneShot } from '../lib/audio.ts';
import { GraphicContent, GraphicPlace, MotionSection, TimingSection, TransitionSection, useTemplate, useTemplates } from './GraphicControls.tsx';
import { Icon } from './Brand.tsx';
import { lookKind } from '../lib/look.ts';
import { KEY_NEAR, valuesPatch, withZoomKey, zoomEasePatch } from '../lib/anim.ts';
import { deleteOps, useLayout } from '../lib/layout.ts';
import { anchorPatch } from './EditHandles.tsx';
import { TranscriptNeeded } from './Transcribe.tsx';

/** Captions from the transcript of what is left after the cuts — no AI, no cost. */
export function autoCaptions() {
  const name = useStore.getState().name!;
  api.post<{ project: never; rev: number; history: never; count: number }>(`${projectPath(name)}/captions`, {}).then((r) => {
    useStore.setState({ project: r.project, rev: r.rev, history: r.history });
    const lit = !!useStore.getState().project?.settings.captionStyle?.highlight;
    useStore.getState().notify(lit ? `${r.count} سطر كابشن` : `${r.count} سطر كابشن — حدد سطرًا وفعّل «الكلمة المنطوقة» لتلوين الكلام`, 'info');
  }).catch((e) => useStore.getState().notify(e.message));
}

const NEUTRAL = Grade.parse({});
/** Latin text (60 fps, -14 LUFS) kept in its own order inside Arabic — an option can't hold a <bdi> */
const ltr = (t: string) => `\u2066${t}\u2069`;

export function Inspector() {
  const project = useStore((s) => s.project)!;
  const selected = useStore((s) => s.selected);
  const clips = project.clips.filter((c) => selected.includes(c.id));
  const clip = clips[0];
  return (
    <div className="h-full overflow-y-auto">
      {clip ? <ClipInspector clip={clip} count={clips.length} project={project} /> : <ProjectInspector project={project} />}
    </div>
  );
}

// A clip's properties, split by what they touch into short tabs (the picture, its sound, its
// timing — or a text's words, a graphic's content and place). Each kind of clip remembers its last tab.
type TabId = 'picture' | 'audio' | 'time' | 'text' | 'content' | 'place' | 'theme' | 'project' | 'sfx';
const TAB_LABEL: Record<TabId, string> = { picture: 'الصورة', audio: 'الصوت', time: 'الوقت', text: 'النص', content: 'المحتوى', place: 'المكان', theme: 'الهوية', project: 'المشروع', sfx: 'المؤثرات' };
type ClipKind = 'visual' | 'audio' | 'text' | 'graphic';

function useTab(kind: ClipKind | 'project', tabs: TabId[]): [TabId, (t: TabId) => void] {
  const key = `inspector-tab:${kind}`;
  const [tab, setTab] = useState<TabId>(() => {
    try { return (localStorage.getItem(key) as TabId | null) ?? tabs[0]; } catch { return tabs[0]; }
  });
  const pick = (t: TabId) => {
    setTab(t);
    try { localStorage.setItem(key, t); } catch { /* private mode */ }
  };
  return [tabs.includes(tab) ? tab : tabs[0], pick];
}

function TabBar({ tabs, tab, setTab }: { tabs: TabId[]; tab: TabId; setTab: (t: TabId) => void }) {
  return (
    <div className="inspector-tabs" role="tablist" aria-label="أقسام الخصائص">
      {tabs.map((t) => <button key={t} role="tab" aria-selected={t === tab} className="inspector-tab" onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
    </div>
  );
}

function clipKind(clip: Clip, project: Project): ClipKind {
  if (clip.graphic) return 'graphic';
  if (clip.text !== undefined || clip.mediaId === undefined) return 'text';
  const media = project.media.find((m) => m.id === clip.mediaId);
  return media?.kind === 'audio' || project.tracks.find((t) => t.id === clip.trackId)?.kind === 'audio' ? 'audio' : 'visual';
}

function ClipInspector({ clip, count, project }: { clip: Clip; count: number; project: Project }) {
  const kind = clipKind(clip, project);
  // a new kind of clip starts on that kind's last tab
  return <ClipTabs key={kind} kind={kind} clip={clip} count={count} project={project} />;
}

function ClipTabs({ kind, clip, count, project }: { kind: ClipKind; clip: Clip; count: number; project: Project }) {
  const media = project.media.find((m) => m.id === clip.mediaId);
  const main = clip.trackId === MAIN_TRACK;
  const tabs: TabId[] = kind === 'graphic' ? ['content', 'place', 'time', 'theme']
    : kind === 'text' ? ['text', 'time']
    : kind === 'audio' ? ['audio', 'time']
    : ['picture', ...(media?.hasAudio ? ['audio' as const] : []), 'time'];
  const [tab, setTab] = useTab(kind, tabs);
  const editText = useStore((s) => s.editText);
  useEffect(() => { if (editText === clip.id && kind === 'text') setTab('text'); }, [editText, clip.id, kind]);
  return (
    <>
      <ClipSummary clip={clip} count={count} project={project} kind={kind} />
      <TabBar tabs={tabs} tab={tab} setTab={setTab} />
      <div role="tabpanel" aria-label={TAB_LABEL[tab]}>
        {tab === 'picture' && (main ? <><ZoomSection clip={clip} /><PlaceSection clip={clip} /><FrameSection clip={clip} /></> : <><PlaceSection clip={clip} /><FrameSection clip={clip} /><ZoomSection clip={clip} /></>)}
        {tab === 'audio' && <AudioSection clip={clip} />}
        {tab === 'time' && <>
          {(kind === 'visual' && media?.kind !== 'image' || kind === 'audio') && <SpeedSection clip={clip} />}
          {!main && count === 1 && <TimingSection clip={clip} />}
          {main && count === 1 && <TransitionSection clip={clip} project={project} />}
          {!main && count === 1 && kind === 'visual' && <MotionSection clip={clip} />}
        </>}
        {tab === 'text' && <TextControls clip={clip} />}
        {tab === 'content' && <GraphicContent clip={clip} />}
        {tab === 'place' && <GraphicPlace clip={clip} />}
        {tab === 'theme' && <ThemeSection project={project} />}
      </div>
    </>
  );
}

const KIND_COLOR: Record<string, string> = { video: 'var(--color-clip-video)', overlay: 'var(--color-clip-overlay)', text: 'var(--color-clip-text)', audio: 'var(--color-clip-audio)' };

/** What is selected, in one glance: its name and length, where it plays from, and the one-click edits. */
function ClipSummary({ clip, count, project, kind }: { clip: Clip; count: number; project: Project; kind: ClipKind }) {
  const name = useStore((s) => s.name)!;
  const ids = useStore((s) => s.selected);
  const { ops, select } = useStore.getState();
  const tpl = useTemplate(name, clip.graphic);
  const media = project.media.find((m) => m.id === clip.mediaId);
  const track = project.tracks.find((t) => t.id === clip.trackId);
  const grade = clip.grade ?? project.settings.defaultGrade;
  const graded = grade && Object.entries(grade).some(([k, v]) => v !== NEUTRAL[k as keyof Grade] && !!(k !== 'lut' || v));
  const title = count > 1 ? `${count} لقطات` : kind === 'text' ? (clip.text?.trim() || 'نص') : kind === 'graphic' ? (tpl?.name ?? clip.graphic?.replace(/^(lib|graphics)\//, '')) : media?.name ?? clip.label ?? 'لقطة';
  return (
    <div className="clip-summary">
      <div className="clip-summary-title">
        <span className="clip-summary-swatch" style={{ background: KIND_COLOR[track?.kind ?? 'video'] }} />
        <b><bdi>{title}</bdi></b>
        <span className="num">{fmtTime(clipDuration(clip), 2)}</span>
      </div>
      <div className="clip-summary-meta">
        {track?.name}
        {media && media.kind !== 'image' && <span className="num" dir="ltr">{fmtTime(clip.in, 2)} → {fmtTime(clip.out, 2)}</span>}
        {clip.speed !== 1 && <span className="num" dir="ltr">×{clip.speed}</span>}
      </div>
      {kind === 'visual' && graded && <p className="text-[11px] text-ink-400">عليه تلوين — <button className="underline" onClick={() => ops(ids.map((id) => ({ op: 'update_clip' as const, clipId: id, patch: { grade: project.settings.defaultGrade ? { ...NEUTRAL, lut: '' } : null } })))}>إزالة</button></p>}
      <div className="clip-summary-actions">
        {count === 1 && <ClipActions clip={clip} project={project} />}
        <button className="btn btn-ghost clip-delete" title="حذف (Delete)" onClick={async () => { if (await ops(deleteOps(ids))) select([]); }}><Icon name="trash" size={14} /> حذف</button>
      </div>
    </div>
  );
}

function SpeedSection({ clip }: { clip: Clip }) {
  const { ops } = useStore.getState();
  return (
    <Section title="السرعة">
      <div className="seg-buttons speed-buttons">
        {[...new Set([0.5, 1, 1.5, 2, 4, clip.speed])].sort((a, b) => a - b).map((s) => (
          <button key={s} className="btn num" dir="ltr" aria-pressed={clip.speed === s} onClick={() => ops([{ op: 'update_clip', clipId: clip.id, patch: { speed: s } }])}>{s}×</button>
        ))}
        <select className="field" aria-label="سرعة أخرى" value="" onChange={(e) => e.target.value && ops([{ op: 'update_clip', clipId: clip.id, patch: { speed: Number(e.target.value) } }])}>
          <option value="">أخرى…</option>
          {[0.25, 0.75, 1.25, 3, 8, 16].map((s) => <option key={s} value={s}>{ltr(`${s}×`)}</option>)}
        </select>
      </div>
    </Section>
  );
}

function AudioSection({ clip }: { clip: Clip }) {
  const { preview, commit } = useStore.getState();
  return (
    <Section title="الصوت">
      <Row label="المستوى"><KeySlider clip={clip} prop="volume" min={0} max={2} step={0.05} def={1} fmt={(v) => `${Math.round(v * 100)}%`} /></Row>
      {(['fadeIn', 'fadeOut'] as const).map((k) => (
        <Row key={k} label={k === 'fadeIn' ? 'يبدأ تدريجي' : 'يختفي تدريجي'}>
          <Slider value={clip[k] ?? 0} min={0} max={Math.min(5, clipDuration(clip) / 2)} step={0.05} def={0} fmt={(v) => `${v.toFixed(1)}ث`}
            onPreview={(v) => preview([{ op: 'update_clip', clipId: clip.id, patch: { [k]: v } }])}
            onCommit={(v) => commit([{ op: 'update_clip', clipId: clip.id, patch: { [k]: v } }])} />
        </Row>
      ))}
      <DenoiseRow clip={clip} />
    </Section>
  );
}

/** Zoom into the picture and the point it centres on — keyed at the playhead once it has keys. */
function ZoomSection({ clip }: { clip: Clip }) {
  const { preview, commit, ops } = useStore.getState();
  const time = useStore((s) => s.time);
  const tr = clip.transform;
  const local = Math.min(Math.max(0, time - clip.start), clipDuration(clip));
  const now = transformAt(tr, local);
  const zoomHere = tr?.keyframes.find((k) => Math.abs(k.t - local) < KEY_NEAR);
  const zoomNext = tr?.keyframes.some((k) => k.t > local + KEY_NEAR);
  const trOps = (patch: Partial<NonNullable<Clip['transform']>>): Op[] => [{ op: 'update_clip', clipId: clip.id, patch: { transform: patch } }];
  const showFocus = useLayout((s) => s.showFocus);
  const setTr = (k: 'scale' | 'x' | 'y', v: number, c: boolean) => {
    // with keyframes, sliders edit the keyframe at the playhead
    if (tr?.keyframes.length) {
      const kfs = withZoomKey(tr.keyframes, { t: local, ...now, [k]: v });
      return c ? commit(trOps({ keyframes: kfs })) : preview(trOps({ keyframes: kfs }));
    }
    return c ? commit(trOps({ [k]: v })) : preview(trOps({ [k]: v }));
  };
  return (
    <Section title={clip.trackId === MAIN_TRACK ? 'تكبير وتركيز' : 'تكبير داخل اللقطة'} actions={
      <>
        <button className="btn btn-ghost h-6 text-xs" aria-pressed={showFocus} title="أظهر نقطة التركيز على المعاينة (ونقطة ارتكاز الطبقة) — واسحبها لتغيير التركيز" onClick={() => useLayout.getState().setShowFocus(!showFocus)}>◎ نقطة التركيز</button>
        <button className="btn btn-ghost h-6 text-xs" title="أضف نقطة حركة عند المؤشر" onClick={() => ops(trOps({ keyframes: withZoomKey(tr?.keyframes, { t: local, ...now }) }))}>◆ حركة</button>
        {tr && <button className="btn btn-ghost h-6 text-xs" onClick={() => ops([{ op: 'update_clip', clipId: clip.id, patch: { transform: null } }])}>إعادة</button>}
      </>
    }>
      <Row label="التكبير"><Slider value={now.scale} min={1} max={5} step={0.01} def={1} hardMax={20} fmt={(v) => `${Math.round(v * 100)}%`} onPreview={(v) => setTr('scale', v, false)} onCommit={(v) => setTr('scale', v, true)} /></Row>
      <Row label="التركيز أفقي"><Slider value={now.x} min={0} max={1} step={0.005} def={0.5} onPreview={(v) => setTr('x', v, false)} onCommit={(v) => setTr('x', v, true)} /></Row>
      <Row label="التركيز عمودي"><Slider value={now.y} min={0} max={1} step={0.005} def={0.5} onPreview={(v) => setTr('y', v, false)} onCommit={(v) => setTr('y', v, true)} /></Row>
      {!!tr?.keyframes.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {[...tr.keyframes].sort((a, b) => a.t - b.t).map((k) => (
            <button key={k.t} className="btn h-6 px-2 text-[11px]" onClick={() => useStore.getState().seek(clip.start + k.t)}
              onContextMenu={(e) => { e.preventDefault(); ops(trOps({ keyframes: tr.keyframes.filter((x) => x !== k) })); }}
              title="نقرة: انتقل · زر يمين: احذف">
              ◆ <span className="num">{k.t.toFixed(1)}s</span> {Math.round(k.scale * 100)}%
            </button>
          ))}
        </div>
      )}
      {zoomHere && zoomNext && <EaseRow value={zoomHere.ease} onPick={(e) => commit([{ op: 'update_clip', clipId: clip.id, patch: zoomEasePatch(clip, local, e) }])} />}
    </Section>
  );
}

/** A layer above the main track: where it sits on the frame and how big (picture-in-picture), keyable. */
function PlaceSection({ clip }: { clip: Clip }) {
  const { ops } = useStore.getState();
  const time = useStore((s) => s.time);
  // a corner / the centre at the playhead (a key there when the place moves); full frame drops the place and its keys
  const plOps = (patch: Partial<Place> | null): Op[] => [{ op: 'update_clip', clipId: clip.id, patch: patch ? valuesPatch(clip, patch, time - clip.start) : { place: null, anim: { dx: null, dy: null, scale: null } } }];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // corners for picture-in-picture: a third of the frame, a small margin from the edges
  const corner = (sx: number, sy: number) => { const s = 0.35, m = 0.5 - s / 2 - 0.03; return { scale: s, dx: sx * m, dy: sy * m }; };
  return (
    <Section title="الحجم والمكان">
      <Row label="بسرعة">
        <div className="flex items-center gap-2">
          <div className="position-grid" role="group" aria-label="موضع اللقطة">
            {[-1, 0, 1].flatMap((y) => [1, 0, -1].map((x) => {
              const label = positionName(x, y);
              return <button type="button" key={`${x}-${y}`} title={label} aria-label={label} onClick={() => ops(plOps(x === 0 && y === 0 ? { dx: 0, dy: 0 } : corner(x, y)))}><span style={{ left: `${50 + x * 30}%`, top: `${50 + y * 30}%` }} /></button>;
            }))}
          </div>
          <button className="btn btn-ghost" title="ملء الشاشة وإزالة حركة المكان والحجم" onClick={() => ops(plOps(null))}>ملء الشاشة</button>
        </div>
      </Row>
      <Row label="الحجم"><KeySlider clip={clip} prop="scale" min={0.1} max={4} step={0.01} def={1} fmt={pct} hardMin={PLACE_LIMITS.scaleMin} hardMax={PLACE_LIMITS.scaleMax} /></Row>
      <Row label="أفقي"><KeySlider clip={clip} prop="dx" min={-1.5} max={1.5} step={0.005} def={0} fmt={pct} hardMin={-PLACE_LIMITS.d} hardMax={PLACE_LIMITS.d} /></Row>
      <Row label="عمودي"><KeySlider clip={clip} prop="dy" min={-1.5} max={1.5} step={0.005} def={0} fmt={pct} hardMin={-PLACE_LIMITS.d} hardMax={PLACE_LIMITS.d} /></Row>
      <AnchorRow clip={clip} />
      <div className="text-[11px] text-ink-500">أو اسحبها على الفيديو، والزاوية للحجم. اكتب أي رقم في الخانة لقيم أبعد من الشريط (الحجم لين {PLACE_LIMITS.scaleMax * 100}%).</div>
    </Section>
  );
}

const positionName = (x: number, y: number) => x === 0 && y === 0 ? 'الوسط' : `${y < 0 ? 'أعلى' : y > 0 ? 'أسفل' : 'وسط'} ${x > 0 ? 'اليمين' : x < 0 ? 'اليسار' : 'الوسط'}`;

/** Where the size grows from: 9 quick points, exact values, and ◎ to see / drag it on the preview. The picture never jumps. */
function AnchorRow({ clip }: { clip: Clip }) {
  const { commit } = useStore.getState();
  const time = useStore((s) => s.time);
  const showFocus = useLayout((s) => s.showFocus);
  const pl = placeAt(clip, time - clip.start);
  const set = (ax: number, ay: number) => commit([{ op: 'update_clip', clipId: clip.id, patch: anchorPatch(clip, pl, ax, ay) }]);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return <>
    <Row label="الارتكاز" hint="النقطة اللي الحجم يكبر ويصغر حولها. تغييرها ما يحرّك الصورة.">
      <div className="flex items-center gap-2">
        <div className="anchor-grid" role="group" aria-label="نقطة الارتكاز">
          {[0, 0.5, 1].flatMap((y) => [1, 0.5, 0].map((x) => (
            <button key={`${x}-${y}`} type="button" aria-pressed={Math.abs(pl.ax - x) < 0.01 && Math.abs(pl.ay - y) < 0.01} aria-label={positionName(x * 2 - 1, y * 2 - 1)} title={positionName(x * 2 - 1, y * 2 - 1)} onClick={() => set(x, y)} />
          )))}
        </div>
        <button type="button" className="btn btn-ghost h-6 px-2 text-[11px]" aria-pressed={showFocus} title="أظهر نقطة الارتكاز على المعاينة واسحبها لأي مكان" onClick={() => useLayout.getState().setShowFocus(!showFocus)}>◎ على المعاينة</button>
      </div>
    </Row>
    <Row label="ارتكاز أفقي"><Slider value={pl.ax} min={0} max={1} step={0.01} def={0.5} fmt={pct} onPreview={() => {}} onCommit={(v) => set(v, pl.ay)} /></Row>
    <Row label="ارتكاز عمودي"><Slider value={pl.ay} min={0} max={1} step={0.01} def={0.5} fmt={pct} onPreview={() => {}} onCommit={(v) => set(pl.ax, v)} /></Row>
  </>;
}

/** How the picture fills the frame: fit, opacity, rotation, flip — and cropping its edges, folded away. */
function FrameSection({ clip }: { clip: Clip }) {
  const { preview, commit, ops } = useStore.getState();
  const pic = Picture.parse(clip.picture ?? {});
  const layer = clip.trackId !== MAIN_TRACK;
  const picOps = (patch: NonNullable<Extract<Op, { op: 'update_clip' }>['patch']['picture']>): Op[] => [{ op: 'update_clip', clipId: clip.id, patch: { picture: patch } }];
  const slide = (make: (v: number) => Op[]) => ({ onPreview: (v: number) => preview(make(v)), onCommit: (v: number) => commit(make(v)) });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const cropped = pic.crop.l || pic.crop.r || pic.crop.t || pic.crop.b;
  // opens by itself on a cropped clip, then only the user closes it (a slider dragged back to 0 must not fold it away)
  const [cropOpen, setCropOpen] = useState(!!cropped);
  useEffect(() => { if (cropped) setCropOpen(true); }, [clip.id, !!cropped]);
  return (
    <Section title="الإطار" actions={(clip.picture || clip.anim?.opacity) && <button className="btn btn-ghost h-6 text-xs" onClick={() => ops([{ op: 'update_clip', clipId: clip.id, patch: { picture: null, anim: { opacity: null } } }])}>إعادة</button>}>
      <Row label="الملاءمة">
        <div className="seg-buttons">
          <button className="btn" aria-pressed={pic.fit === 'fill'} title="تملأ الإطار (تنقص الأطراف)" onClick={() => ops(picOps({ fit: 'fill' }))}>ملء</button>
          <button className="btn" aria-pressed={pic.fit === 'fit'} title="الصورة كاملة، مع أشرطة حولها" onClick={() => ops(picOps({ fit: 'fit' }))}>احتواء</button>
        </div>
      </Row>
      {!layer && pic.fit === 'fit' && (
        <Row label="حولها">
          <div className="seg-buttons">
            <button className="btn" aria-pressed={pic.bars === 'black'} onClick={() => ops(picOps({ bars: 'black' }))}>أسود</button>
            <button className="btn" aria-pressed={pic.bars === 'blur'} title="نسخة مكبّرة ومموّهة من نفس اللقطة — مثل الشورتس" onClick={() => ops(picOps({ bars: 'blur' }))}>ضبابي</button>
          </div>
        </Row>
      )}
      <Row label="الشفافية" hint={layer ? undefined : 'على المسار الرئيسي: تظهر من الأسود وتختفي فيه'}><KeySlider clip={clip} prop="opacity" min={0} max={1} step={0.01} def={1} fmt={pct} /></Row>
      <Row label="تدوير">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1"><Slider value={pic.rotate} min={-180} max={180} step={1} def={0} fmt={(v) => `${Math.round(v)}°`} {...slide((v) => picOps({ rotate: v }))} /></div>
          <button className="btn btn-ghost h-6 px-1.5 text-[11px]" title="90° مع عقارب الساعة" onClick={() => ops(picOps({ rotate: ((pic.rotate + 90 + 180) % 360) - 180 }))}>↻</button>
        </div>
      </Row>
      <Row label="قلب">
        <div className="seg-buttons">
          <button className="btn" aria-pressed={pic.flipX} onClick={() => ops(picOps({ flipX: !pic.flipX }))}>⇆ أفقي</button>
          <button className="btn" aria-pressed={pic.flipY} onClick={() => ops(picOps({ flipY: !pic.flipY }))}>⇅ عمودي</button>
        </div>
      </Row>
      <details className="fold" open={cropOpen} onToggle={(e) => setCropOpen(e.currentTarget.open)}>
        <summary>قص الأطراف{cropped ? ' ·' : ''}</summary>
        {([['l', 'يسار'], ['r', 'يمين'], ['t', 'فوق'], ['b', 'تحت']] as const).map(([k, label]) => (
          <Row key={k} label={label}><Slider value={pic.crop[k]} min={0} max={0.45} step={0.005} def={0} fmt={pct} {...slide((v) => picOps({ crop: { [k]: v } }))} /></Row>
        ))}
      </details>
    </Section>
  );
}

/** Voice cleanup strength, heard before choosing: a few seconds from the playhead, as recorded and as the export cleans it (the live preview plays a close, lighter version). */
function DenoiseRow({ clip }: { clip: Clip }) {
  const { preview, commit, notify } = useStore.getState();
  const [playing, setPlaying] = useState<'off' | 'on'>();
  const player = useRef<HTMLAudioElement>();
  useEffect(() => () => player.current?.pause(), []);
  const listen = async (which: 'off' | 'on') => {
    player.current?.pause();
    if (playing === which) return setPlaying(undefined);
    const { name, time } = useStore.getState();
    setPlaying(which);
    try {
      const res = await fetch(`${projectPath(name!)}/clips/${clip.id}/denoise-preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strength: which === 'on' ? clip.denoise || 0.5 : 0, at: Math.max(0, time - clip.start) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'ما قدرت أجهز المقطع');
      const a = new Audio(URL.createObjectURL(await res.blob()));
      player.current = a;
      a.onended = () => setPlaying(undefined);
      await a.play();
    } catch (e) {
      setPlaying(undefined);
      notify((e as Error).message);
    }
  };
  const v = clip.denoise ?? 0;
  const siblings = useStore((s) => s.project!.clips).filter((c) => c.mediaId === clip.mediaId && c.id !== clip.id && c.trackId === clip.trackId);
  return (
    <Row label="تنقية الصوت" hint="يشيل الهمهمة والضجيج اللي ورا الصوت. المعاينة الحية تسمّعك تقريبًا له؛ «بعد التنقية» يسمّعك نفس اللي بيطلع في التصدير.">
      <div className="min-w-0">
        <Slider value={v} min={0} max={1} step={0.05} def={0} fmt={(x) => (x > 0 ? `${Math.round(x * 100)}%` : 'طافية')}
          onPreview={(x) => preview([{ op: 'update_clip', clipId: clip.id, patch: { denoise: x } }])}
          onCommit={(x) => commit([{ op: 'update_clip', clipId: clip.id, patch: { denoise: x } }])} />
        <div className="mt-1 flex gap-1">
          <button className="btn btn-ghost h-6 flex-1 justify-center text-[11px]" aria-pressed={playing === 'off'} onClick={() => listen('off')}>{playing === 'off' ? '■ ' : '▶ '}الأصل</button>
          <button className="btn btn-ghost h-6 flex-1 justify-center text-[11px]" aria-pressed={playing === 'on'} onClick={() => listen('on')}>{playing === 'on' ? '■ ' : '▶ '}بعد التنقية{v ? '' : ' (50%)'}</button>
        </div>
        {siblings.length > 0 && siblings.some((c) => (c.denoise ?? 0) !== v) && (
          <button className="btn btn-ghost mt-1 h-6 w-full justify-center text-[11px]" title="بعد القص صار التسجيل الواحد عدة لقطات"
            onClick={() => commit(siblings.map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { denoise: v } })))}>
            نفس التنقية لكل لقطات هذا التسجيل ({siblings.length + 1})
          </button>
        )}
      </div>
    </Row>
  );
}

/** One-click edits on a clip (CapCut's toolbar): hold a frame, play backwards, detach the sound, copy / paste its look. */
function ClipActions({ clip, project }: { clip: Clip; project: Project }) {
  const { ops, clipTool, copyLook, pasteLook } = useStore.getState();
  const time = useStore((s) => s.time);
  const look = useStore((s) => s.look);
  const selected = useStore((s) => s.selected);
  const media = project.media.find((m) => m.id === clip.mediaId);
  // the reversed copy of this media is being made (the job is named after it)
  const reversing = useStore((s) => Object.values(s.jobs).some((j) => j.kind === 'reverse' && (j.status === 'queued' || j.status === 'running') && j.label === `عكس ${media?.name}`));
  const video = media?.kind === 'video';
  const onAudioTrack = project.tracks.find((t) => t.id === clip.trackId)?.kind === 'audio';
  const inside = time >= clip.start && time < clipEnd(clip);
  const reversed = media?.derived?.kind === 'reverse';
  const pastable = look && look.from !== clip.id && look.kind === lookKind(clip);
  return (
    <div className="clip-actions">
      {video && !onAudioTrack && <>
        {media.hasAudio && <button className="btn" aria-pressed={!!clip.picture?.off} title="يحفظ مكان اللقطة وطولها ويشغّل صوتها بدون الصورة" onClick={() => ops([{ op: 'update_clip', clipId: clip.id, patch: { picture: { off: !clip.picture?.off } } }])}><Icon name="speaker" size={14} /> صوت فقط</button>}
        <button className="btn" disabled={!inside} title={inside ? 'يوقف الصورة عند المؤشر ثانيتين، وبعدها تكمل اللقطة' : 'حط المؤشر داخل اللقطة'}
          onClick={() => clipTool(clip.id, 'freeze', { at: time, duration: 2 })}><Icon name="freeze" size={14} /> تجميد</button>
        <button className="btn" aria-pressed={reversed} disabled={reversing} title={reversed ? 'رجّعها لاتجاهها الأصلي' : 'تشتغل اللقطة (وصوتها) بالعكس — أول مرة تتجهّز نسخة معكوسة'}
          onClick={() => clipTool(clip.id, 'reverse')}><Icon name="reverse" size={14} /> {reversing ? 'يعكس…' : 'عكس'}</button>
        {media.hasAudio && clip.volume > 0 && (
          <button className="btn" title="الصوت يصير لقطة لحاله على مسار صوت، بنفس التوقيت" onClick={() => ops([{ op: 'detach_audio', clipId: clip.id }])}><Icon name="detach" size={14} /> فصل الصوت</button>
        )}
      </>}
      <button className="btn" title="نسخ خصائص اللقطة (Ctrl+Alt+C)" onClick={() => copyLook(clip.id)}><Icon name="copy" size={14} /> نسخ الخصائص</button>
      {pastable && <button className="btn" title="لصق الخصائص المنسوخة على المحدد (Ctrl+Alt+V)" onClick={() => pasteLook(selected.includes(clip.id) ? selected : [clip.id])}><Icon name="paste" size={14} /> لصق</button>}
    </div>
  );
}

/** Word-linked captions can light the word being spoken; set on all captions of the track at once (and for new ones). */
function SpokenWord({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project)!;
  const transcripts = useStore((s) => s.transcripts);
  const color = clip.textStyle?.highlight;
  const captions = project.clips.filter((c) => c.trackId === clip.trackId && c.text && c.words);
  const matches = !!captionWordStarts(project, clip, (m) => transcripts[m]?.words);
  const apply = (highlight: string | null) => {
    const { highlight: _, ...rest } = project.settings.captionStyle ?? {};
    const captionStyle = highlight ? { ...rest, highlight } : Object.keys(rest).length ? rest : null;
    useStore.getState().commit([
      ...captions.map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { textStyle: { highlight } } })),
      { op: 'set_settings', patch: { captionStyle } },
    ]);
  };
  return (
    <Row label="الكلمة المنطوقة">
      <div className="spoken-word">
        <label><input type="checkbox" checked={!!color} onChange={(e) => apply(e.target.checked ? project.settings.theme.accent : null)} /> لوّنها أثناء الكلام</label>
        {color && <input type="color" aria-label="لون الكلمة المنطوقة" value={color.startsWith('#') ? color.slice(0, 7) : project.settings.theme.accent} onChange={(e) => apply(e.target.value)} />}
        <p>{color && !matches ? 'هذا السطر اتعدّل أو كلامه ما انفرّغ — يظهر بدون تلوين.' : `لكل الكابشن في هذا المسار (${captions.length})، وللكابشن الجديد.`}</p>
      </div>
    </Row>
  );
}

function TextControls({ clip }: { clip: Clip }) {
  const { preview, commit, ops } = useStore.getState();
  const st = TextStyle.parse(clip.textStyle ?? {});
  const themeText = useStore((x) => x.project!.settings.theme.text);
  const [text, setText] = useState(clip.text ?? '');
  const input = useRef<HTMLTextAreaElement>(null);
  const editText = useStore((s) => s.editText);
  useEffect(() => {
    if (editText !== clip.id) return;
    input.current?.focus();
    input.current?.select();
    useStore.setState({ editText: undefined });
  }, [editText, clip.id]);
  useEffect(() => setText(clip.text ?? ''), [clip.id, clip.text]);
  const style = (patch: Partial<Omit<TextStyle, 'background'>> & { background?: string | null }, c = true) => {
    const o: Op[] = [{ op: 'update_clip', clipId: clip.id, patch: { textStyle: patch } }];
    return c ? commit(o) : preview(o);
  };
  return (
    <Section title="النص">
      <textarea ref={input} aria-label="محتوى النص" className="field mb-2 h-20 w-full resize-none py-1 leading-6" dir="rtl" value={text}
        onChange={(e) => setText(e.target.value)} onBlur={() => text !== clip.text && ops([{ op: 'update_clip', clipId: clip.id, patch: { text } }])} />
      <Row label="الشكل">
        <select className="field" value={st.preset} onChange={(e) => style({ preset: e.target.value as TextStyle['preset'] })}>
          <option value="title">عنوان</option><option value="lower-third">لوثر ثيرد</option><option value="caption">كابشن</option><option value="label">وسم</option><option value="card">بطاقة</option>
        </select>
      </Row>
      <Row label="الحركة">
        <select className="field" value={st.animation} onChange={(e) => style({ animation: e.target.value as TextStyle['animation'] })}>
          <option value="fade">ظهور</option><option value="slide-up">صعود</option><option value="pop">نبض</option><option value="none">بدون</option>
        </select>
      </Row>
      {clip.words && <SpokenWord clip={clip} />}
      <Row label="الحجم"><Slider value={st.size} min={20} max={180} step={1} def={TextStyle.parse({}).size} hardMin={6} hardMax={1200} fmt={(v) => `${v}px`} onPreview={(v) => style({ size: v }, false)} onCommit={(v) => style({ size: v })} /></Row>
      <Row label="الوزن">
        <select className="field" value={st.weight} onChange={(e) => style({ weight: Number(e.target.value) })}>
          {[400, 500, 600, 700].map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </Row>
      <Row label="اللون"><input type="color" className="h-7 w-full cursor-pointer rounded bg-transparent" value={st.color ?? themeText} onChange={(e) => style({ color: e.target.value }, false)} onBlur={(e) => style({ color: e.target.value })} /></Row>
      <Row label="الخلفية">
        <div className="flex gap-2">
          <input type="color" className="h-7 flex-1 cursor-pointer rounded bg-transparent" value={st.background?.startsWith('#') ? st.background.slice(0, 7) : '#14161c'} onChange={(e) => style({ background: e.target.value }, false)} onBlur={(e) => style({ background: e.target.value })} />
          <button className="btn h-7 text-xs" onClick={() => style({ background: null })}>افتراضي</button>
        </div>
      </Row>
      <Row label="أفقي"><Slider value={st.x} min={0} max={1} step={0.005} def={0.5} hardMin={-0.5} hardMax={1.5} onPreview={(v) => style({ x: v }, false)} onCommit={(v) => style({ x: v })} /></Row>
      <Row label="عمودي"><Slider value={st.y} min={0} max={1} step={0.005} def={0.5} hardMin={-0.5} hardMax={1.5} onPreview={(v) => style({ y: v }, false)} onCommit={(v) => style({ y: v })} /></Row>
      <Row label="المحاذاة">
        <div className="flex gap-1">
          {(['start', 'center', 'end'] as const).map((a) => (
            <button key={a} className={`btn h-7 flex-1 justify-center ${st.align === a ? 'border-accent text-accent' : ''}`} onClick={() => style({ align: a })}>{{ start: 'يمين', center: 'وسط', end: 'يسار' }[a]}</button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

const THEMES: { name: string; theme: Partial<Theme> }[] = [
  { name: 'داكن', theme: { accent: '#f2b33d', accent2: '#5ec2ff', panel: 'rgba(14,16,24,0.88)', text: '#ffffff' } },
  { name: 'فاتح', theme: { accent: '#2563eb', accent2: '#db2777', panel: 'rgba(255,255,255,0.94)', text: '#111827' } },
  { name: 'نيون', theme: { accent: '#22d3ee', accent2: '#a78bfa', panel: 'rgba(10,10,22,0.8)', text: '#f8fafc' } },
  { name: 'دافئ', theme: { accent: '#f97316', accent2: '#facc15', panel: 'rgba(28,20,16,0.9)', text: '#fff7ed' } },
];

/** '#rrggbb' / 'rgba(r,g,b,a)' -> hex + alpha for the colour input and the opacity slider. */
function splitColor(c: string): { hex: string; alpha: number } {
  const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i);
  if (m) return { hex: '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join(''), alpha: m[4] === undefined ? 1 : Number(m[4]) };
  return { hex: /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7) : '#000000', alpha: 1 };
}
const joinColor = (hex: string, alpha: number) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`;
};

/**
 * The project identity: the colours and font every text preset and every graphic that follows it are drawn with.
 * It shows what it changes (a live sample drawn with the export's own markup), what follows it and what doesn't
 * (a text with its own colour, a graphic with colours written into it), and fixes for those.
 */
function ThemeSection({ project }: { project: Project }) {
  const { ops, preview, commit } = useStore.getState();
  const th = project.settings.theme;
  const panel = splitColor(th.panel);
  const theme = (patch: Partial<Theme>, c = true) => {
    const o: Op[] = [{ op: 'set_settings', patch: { theme: patch } }];
    return c ? commit(o) : preview(o);
  };
  const color = (k: 'accent' | 'accent2' | 'text', label: string, hint: string) => (
    <Row label={label} hint={hint}>
      <div className="theme-color">
        <input type="color" value={th[k]} onChange={(e) => theme({ [k]: e.target.value }, false)} onBlur={(e) => theme({ [k]: e.target.value })} aria-label={label} />
        <span className="num" dir="ltr">{th[k]}</span>
      </div>
    </Row>
  );
  const isPreset = (t: Partial<Theme>) => t.accent === th.accent && t.panel === th.panel && t.text === th.text;
  return (
    <>
      <Section title="الهوية" actions={<button className="btn btn-ghost h-6 text-xs" title="رجّع الهوية الافتراضية" onClick={() => ops([{ op: 'set_settings', patch: { theme: Theme.parse({}) } }])}>إعادة</button>}>
        <p className="theme-intro">ألوان وخط العناوين والرسوم في المشروع كله: تغيّرها هنا مرة، وتتغيّر في كل مكان يتبعها.</p>
        <BrandKits project={project} />
        <ThemeSample theme={th} />
        <ThemeReach project={project} />
        <div className="theme-presets">
          {THEMES.map((t) => (
            <button key={t.name} className="theme-preset" aria-pressed={isPreset(t.theme)} title={`هوية ${t.name}`} onClick={() => theme(t.theme)}>
              <span className="theme-preset-card" style={{ background: t.theme.panel, color: t.theme.text, borderInlineStartColor: t.theme.accent }}>عنوان</span>
              {t.name}
            </button>
          ))}
        </div>
      </Section>
      <details><summary className="cursor-pointer text-xs text-ink-400 px-4 py-2">تعديل يدوي</summary>
      <Section title="الألوان">
        {color('accent', 'المميّز', 'الخط الجانبي للعناوين، خلفية الوسوم، والأرقام والإبرازات في الرسوم')}
        {color('accent2', 'الثاني', 'الجهة الثانية في المقارنة وبعض التفاصيل في الرسوم')}
        {color('text', 'الكتابة', 'لون كل الكتابة اللي ما لها لون خاص')}
        <Row label="البطاقات" hint="خلفية العناوين والبطاقات وألواح الرسوم">
          <div className="flex items-center gap-2">
            <div className="theme-color w-20 shrink-0">
              <input type="color" value={panel.hex} aria-label="لون خلفية البطاقات"
                onChange={(e) => theme({ panel: joinColor(e.target.value, panel.alpha) }, false)} onBlur={(e) => theme({ panel: joinColor(e.target.value, panel.alpha) })} />
            </div>
            <div className="min-w-0 flex-1"><Slider value={panel.alpha} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`}
              onPreview={(v) => theme({ panel: joinColor(panel.hex, v) }, false)} onCommit={(v) => theme({ panel: joinColor(panel.hex, v) })} /></div>
          </div>
        </Row>
      </Section>
      <Section title="الخط والاتجاه">
        <div className="theme-fonts" role="radiogroup" aria-label="الخط">
          {THEME_FONTS.map((f) => (
            <button key={f.family} role="radio" aria-checked={th.font === f.family} className="theme-font" onClick={() => theme({ font: f.family })}>
              <span style={{ fontFamily: `'${f.family}'` }}>قصّة {f.family === 'Lalezar' ? '' : 'الفيديو'}</span>
              <small><bdi>{f.family}</bdi> · {f.about}</small>
            </button>
          ))}
          {!project.settings.brand && !THEME_FONTS.some((f) => f.family === th.font) && <p className="text-[11px] text-cut-text">الخط «{th.font}» مو من خطوط المحرر — بيطلع بخط ثاني في التصدير. اختر واحد من فوق.</p>}
        </div>
        <Row label="الاتجاه">
          <select className="field" value={th.direction} onChange={(e) => theme({ direction: e.target.value as Theme['direction'] })}>
            <option value="auto">تلقائي من النص</option><option value="rtl">يمين ← يسار</option><option value="ltr">يسار ← يمين</option>
          </select>
        </Row>
      </Section></details>
    </>
  );
}

/** A title and a label drawn with the identity, the same markup the preview and the export use. */
function ThemeSample({ theme }: { theme: Theme }) {
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const title = { text: 'عنوان بهوية مشروعك', textStyle: TextStyle.parse({ preset: 'lower-third', x: 0.93, y: 0.6, align: 'start', size: 104, animation: 'none' }) };
  const label = { text: 'وسم', textStyle: TextStyle.parse({ preset: 'label', x: 0.93, y: 0.18, align: 'start', size: 84, animation: 'none' }) };
  return (
    <div ref={box} className="theme-sample" aria-label="مثال للهوية">
      {h > 0 && <>
        <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: textLayerHtml(label, h, theme) }} />
        <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: textLayerHtml(title, h, theme) }} />
      </>}
    </div>
  );
}

/** What the identity reaches in this project, and what it doesn't (with a way to bring it in). */
function ThemeReach({ project }: { project: Project }) {
  const name = useStore((s) => s.name)!;
  const { ops, notify } = useStore.getState();
  const { own } = useTemplates(name, true);
  const texts = project.clips.filter((c) => !c.graphic && c.text !== undefined);
  const ownLook = texts.filter((c) => c.textStyle?.color || c.textStyle?.background || c.textStyle?.font);
  const graphics = project.clips.filter((c) => c.graphic);
  const apart = [...new Set(graphics.map((c) => c.graphic!.replace(/\/+$/, '')).filter((g) => own.find((o) => o.graphic === g)?.themed === false))];
  const following = graphics.filter((c) => !apart.includes(c.graphic!.replace(/\/+$/, ''))).length;
  const link = async (g: string) => {
    try {
      await api.post(`${projectPath(name)}/agent`, {
        tier: 'standard',
        text: `اربط الرسمة ${g} بهوية المشروع: استبدل الألوان والخط المكتوبة داخل صفحتها بمتغيرات الهوية (var(--accent) للون المميّز، var(--accent-2) للثاني، var(--text) للكتابة، var(--panel) للبطاقات، var(--font) للخط) بنفس الشكل الحالي، بدون ما تغيّر الحركة أو النصوص.`,
      });
      notify('الذكاء يربط الرسمة بالهوية — تشوف التقدم في «المساعد»', 'info');
    } catch (e) { notify((e as Error).message); }
  };
  if (!texts.length && !graphics.length) return <p className="theme-reach">ما فيه عناوين أو رسوم بعد — أي عنوان أو رسمة من القوالب تضيفها بتاخذ هذي الهوية.</p>;
  return (
    <div className="theme-reach">
      <p>تتبعها الحين: <b>{texts.length - ownLook.length} عنوان ونص</b>{graphics.length > 0 && <> · <b>{following} رسمة</b></>}</p>
      {ownLook.length > 0 && (
        <div className="theme-reach-row">
          <span>{ownLook.length} نص لها لون أو خط خاص، فما تتغيّر معها.</span>
          <button className="btn h-6 text-[11px]" onClick={() => ops(ownLook.map((c) => ({ op: 'update_clip' as const, clipId: c.id, patch: { textStyle: { color: null, background: null, font: null } } })))}>خلّها تتبع الهوية</button>
        </div>
      )}
      {apart.map((g) => (
        <div key={g} className="theme-reach-row">
          <span>رسمة «<bdi>{g.replace(/^graphics\//, '')}</bdi>» ألوانها مكتوبة داخلها{own.find((o) => o.graphic === g)?.themedFont ? ' (تاخذ الخط بس)' : ''}، فما تتغيّر معها.</span>
          <button className="btn h-6 text-[11px]" title="مهمة ذكاء (النموذج المتوسط) تبدّل ألوانها وخطها بمتغيرات الهوية" onClick={() => link(g)}>اربطها بالذكاء</button>
        </div>
      ))}
    </div>
  );
}

/** Sound effects: place them automatically on what happens on screen, or one at the playhead. */
function SfxSection({ project }: { project: Project }) {
  const name = useStore((s) => s.name)!;
  const time = useStore((s) => s.time);
  const { notify } = useStore.getState();
  const [list, setList] = useState<{ id: string; name: string; description: string }[]>([]);
  useEffect(() => { api.get('/api/sfx').then(setList).catch(() => setList([])); }, []);
  const onTrack = project.clips.filter((c) => c.trackId === SFX_TRACK).length;
  const adopt = (r: { project: Project; rev: number; history: { undo: number; redo: number } }) => useStore.setState({ project: r.project, rev: r.rev, history: r.history });
  const auto = () => api.post(`${projectPath(name)}/sfx/auto`, {}).then((r) => {
    adopt(r);
    notify(r.count ? `انحط ${r.count} مؤثر على الرسوم والعناوين والانتقالات — Ctrl+Z يرجّعها` : 'ما لقيت رسوم أو عناوين أو انتقالات تحتاج مؤثر', 'info');
  }).catch((e) => notify(e.message));
  const add = (id: string) => api.post(`${projectPath(name)}/sfx`, { id, at: time }).then(adopt).catch((e) => notify(e.message));
  return (
    <Section title="مؤثرات صوتية" actions={<span className="text-[11px] text-ink-500">{onTrack ? `${onTrack} على مسار المؤثرات` : ''}</span>}>
      <button className="btn btn-primary mb-2 w-full justify-center" onClick={auto} title="هووش للرسوم، بوب للعناوين، سووش للانتقالات — يستبدل التلقائية القديمة ويخلي اللي حطيتها بيدك">
        {AUTO_MARK} ضع المؤثرات تلقائياً
      </button>
      <div className="grid grid-cols-2 gap-1">
        {list.map((s) => (
          <div key={s.id} className="flex items-center gap-1 rounded border border-ink-800 px-1.5 py-1" title={s.description}>
            <button className="text-ink-400 hover:text-accent" title="اسمع" onClick={() => playOneShot(`/api/sfx/${s.id}/audio`, 0.8)}>▶</button>
            <span className="flex-1 truncate text-xs text-ink-200">{s.name}</span>
            <button className="btn btn-ghost h-6 px-1.5 text-[11px]" title="أضفه عند المؤشر" onClick={() => add(s.id)}>+</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ProjectInspector({ project }: { project: Project }) {
  const { ops } = useStore.getState();
  const set = (patch: Partial<Project['settings']>) => ops([{ op: 'set_settings', patch }]);
  const [tab, setTab] = useTab('project', ['project', 'theme', 'sfx']);
  return (
    <>
      <TabBar tabs={['project', 'theme', 'sfx']} tab={tab} setTab={setTab} />
      {tab === 'project' && <>
      <Section title="المشروع">
        <Row label="المقاس">
          <select className="field" value={project.settings.aspect} onChange={(e) => set({ aspect: e.target.value as Project['settings']['aspect'] })}>
            <option value="16:9">16:9 يوتيوب</option><option value="9:16">9:16 شورتس</option><option value="1:1">1:1 مربع</option><option value="4:5">4:5 انستقرام</option>
          </select>
        </Row>
        <Row label="الدقة">
          <select className="field" value={project.settings.resolution} onChange={(e) => set({ resolution: Number(e.target.value) })}>
            <option value={720}>720p</option><option value={1080}>1080p</option><option value={1440}>1440p (2K)</option><option value={2160}>2160p (4K)</option>
          </select>
        </Row>
        <Row label="الفريمات">
          <select className="field" value={project.settings.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
            {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{ltr(`${f} fps`)}</option>)}
          </select>
        </Row>
        <Row label="الصوت" hint="مستوى الصوت النهائي (يوتيوب -14)">
          <select className="field" value={project.settings.loudness} onChange={(e) => set({ loudness: Number(e.target.value) })}>
            {[-16, -14, -12].map((l) => <option key={l} value={l}>{ltr(`${l} LUFS`)}</option>)}
          </select>
        </Row>
        <Row label="تنعيم الحركة" hint="motion blur للرسوم المتحركة — في التصدير النهائي بس (المعاينة تبقى سريعة)">
          <select className="field" value={project.settings.motionBlur} onChange={(e) => set({ motionBlur: Number(e.target.value) })}>
            <option value={0}>بدون</option><option value={4}>عادي (أسرع)</option><option value={8}>ناعم جداً (أبطأ)</option>
          </select>
        </Row>
      </Section>
      <Section title="الستايلات المستخدمة">
        {!project.stylesUsed.length && <p className="text-xs text-ink-400">الستايلات التي تطبقها أو تستخدمها كمرجع تظهر هنا.</p>}
        {project.stylesUsed.map((style) => <button key={style.id} className="used-style-row" onClick={() => useStore.getState().openStyle(style.id, style.source)}><strong>{style.name}</strong><small>{({ preset: 'جاهز', saved: 'محفوظ', library: 'مرجع مكتبة' })[style.source]} · {new Date(style.at).toLocaleDateString('ar-SA', { calendar: 'gregory' })}</small><span>{style.what}</span></button>)}
      </Section>
      <Section title="إضافة">
        <button className="btn w-full justify-center" onClick={() => useStore.getState().addTitle()}>
          + نص عند المؤشر
        </button>
        <button className="btn mt-2 w-full justify-center" title="كابشن من النص المفرّغ — للكلام اللي باقي بعد القص فقط" onClick={autoCaptions}>
          ⧉ كابشن تلقائي من الكلام
        </button>
        <TranscriptNeeded text="الكابشن يحتاج تفريغ" />
      </Section>
      </>}
      {tab === 'theme' && <ThemeSection project={project} />}
      {tab === 'sfx' && <SfxSection project={project} />}

    </>
  );
}
