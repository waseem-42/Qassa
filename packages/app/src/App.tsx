import { useEffect, useRef, useState } from 'react';
import { clipEnd, freeMoveOps, mainClips, mainDuration, projectDuration, timelineToSource } from '@edit/shared';
import { useTimelineView } from './lib/timeline-view.ts';
import { actionFor, comboOf, useKeys } from './lib/keys.ts';
import { Shortcuts } from './components/Shortcuts.tsx';
import { Styles } from './components/Styles.tsx';
import { BOTH_PANELS, connectLive, useStore } from './lib/store.ts';
import { Viewer } from './components/Viewer.tsx';
import { deleteSelectedKey, Timeline, useKeySel } from './components/Timeline.tsx';
import { Transcript } from './components/Transcript.tsx';
import { Inspector } from './components/Inspector.tsx';
import { MediaPanel } from './components/MediaPanel.tsx';
import { Notes } from './components/Notes.tsx';
import { Assistant } from './components/Assistant.tsx';
import { Icon } from './components/Brand.tsx';
import { Header } from './components/Header.tsx';
import { Home as ProjectHome } from './components/Home.tsx';
import { importFiles, isFileDrag, placeMediaRun, removeMedia, useMediaSelection } from './lib/import.ts';
import { Uploads } from './components/Uploads.tsx';
import { RangeDeleteHint } from './components/RangeDeleteHint.tsx';
import { deleteOps, useLayout } from './lib/layout.ts';
import { StartGuide } from './components/StartGuide.tsx';
import { readSplit, saveSplit, timelineSize, useMediaQuery } from './lib/workspace-layout.ts';

export function App() {
  const name = useStore((s) => s.name);
  const project = useStore((s) => s.project);
  const mediaOpen = useStore((s) => s.panels.media);
  const [fileOver, setFileOver] = useState(false);
  const hidden = useLayout((s) => s.hidden);

  useEffect(() => {
    // connectLive loads the project list and the ?p= project as soon as the server answers
    return connectLive();
  }, []);
  useEffect(() => {
    const mq = matchMedia(BOTH_PANELS);
    const fit = () => { if (mq.matches) useStore.setState({ mediaOverlay: false }); };
    mq.addEventListener('change', fit);
    return () => mq.removeEventListener('change', fit);
  }, []);

  useShortcuts();

  return (
    <div className="app-shell flex h-full flex-col"
      onDragOver={(e) => { if (name && isFileDrag(e.dataTransfer)) { e.preventDefault(); setFileOver(true); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false); }}
      onDropCapture={() => setFileOver(false)}
      onDrop={(e) => { if (name && isFileDrag(e.dataTransfer)) { e.preventDefault(); importFiles([...e.dataTransfer.files]); } }}>
      <Header />
      {name && project ? (
        <div className="studio-body">
          {!hidden.rail && <ToolRail />}
          <div className="studio-main">
            <StartGuide key={name} />
            <div className="editor-split">
              <Workspace />
              {!hidden.timeline && <TimelineDock />}
            </div>
          </div>
        </div>
      ) : (
        <ProjectHome />
      )}
      <Toast />
      {fileOver && name && <div className="pointer-events-none fixed inset-2 z-50 rounded-xl border-2 border-dashed border-accent" aria-hidden="true" />}
      {name && !mediaOpen && <div className="fixed bottom-12 left-4 z-50 w-72"><Uploads /></div>}
      <Shortcuts />
      <Styles />
      <RangeDeleteHint />
    </div>
  );
}

const TOOLS = [['assistant', 'sparkles', 'مساعد AI'], ['text', 'text', 'النص'], ['inspect', 'sliders', 'الخصائص'], ['notes', 'comment', 'التعليقات']] as const;

/** The one way between the panels: the media library, the tools panel's pages (with what waits on each), the styles window. */
function ToolRail() {
  const panel = useStore((s) => s.panel);
  const panels = useStore((s) => s.panels);
  const mediaOverlay = useStore((s) => s.mediaOverlay);
  const wide = useMediaQuery(BOTH_PANELS);
  const mediaOn = wide ? panels.media : mediaOverlay;
  const waiting = useStore((s) => (s.project?.suggestions.length ?? 0) + (s.project?.ideas.length ?? 0));
  const openNotes = useStore((s) => s.project?.notes.filter((n) => n.status === 'open').length ?? 0);
  const { showPanel, setPanel } = useStore.getState();
  const count = (id: (typeof TOOLS)[number][0]) => (id === 'assistant' ? waiting : id === 'notes' ? openNotes : 0);
  return (
    <nav className="tool-rail" aria-label="أدوات المونتاج">
      <button className="rail-button" aria-pressed={mediaOn} data-on={mediaOn} title="مكتبة الوسائط" onClick={() => showPanel('media', !mediaOn)}><Icon name="film" size={20} /><span>الوسائط</span></button>
      <span className="rail-divider" />
      {TOOLS.map(([id, icon, label]) => {
        const on = panels.tools && panel === id;
        return (
          <button key={id} className="rail-button" aria-pressed={on} data-on={on} onClick={() => (on ? showPanel('tools', false) : setPanel(id))}>
            <Icon name={icon} size={20} /><span>{label}</span>
            {count(id) > 0 && <i className="rail-count" data-kind={id} aria-label={`${count(id)} بانتظارك`}>{count(id)}</i>}
          </button>
        );
      })}
      <span className="rail-divider" />
      <button className="rail-button" onClick={() => useStore.getState().setStylesOpen(true)}><Icon name="palette" size={20} /><span>الستايلات</span></button>
    </nav>
  );
}

/** Tools panel · the video · media panel, in reading order (RTL: tools beside the rail). */
function Workspace() {
  const panels = useStore((s) => s.panels);
  const mediaOverlay = useStore((s) => s.mediaOverlay);
  const wide = useMediaQuery(BOTH_PANELS);
  const selected = useStore((s) => s.selected);
  const { showPanel } = useStore.getState();
  useEffect(() => {
    if (!mediaOverlay || wide) return;
    const focus = document.activeElement;
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open], [role="menu"]')) return;
      e.preventDefault(); e.stopPropagation(); showPanel('media', false);
    };
    addEventListener('keydown', escape, true);
    return () => {
      removeEventListener('keydown', escape, true);
      requestAnimationFrame(() => { if (focus instanceof HTMLElement && focus.isConnected && focus.checkVisibility()) focus.focus({ preventScroll: true }); });
    };
  }, [mediaOverlay, wide]);
  // selecting a clip opens its properties (even when the tools panel is closed)
  useEffect(() => {
    if (selected.length) useStore.getState().setPanel('inspect');
  }, [selected]);
  return (
    <div className="editor-workspace" data-tools={panels.tools} data-media={panels.media} data-media-overlay={mediaOverlay && !wide}>
      {panels.tools && <div className="workspace-tools"><ToolsPanel onClose={() => showPanel('tools', false)} /></div>}
      <div className="workspace-viewer">
        <div className="workspace-access"><button className="btn" aria-label="مكتبة المشروع" aria-expanded={mediaOverlay && !wide} onClick={() => showPanel('media', !mediaOverlay)}><Icon name="film" size={16} />مكتبة المشروع</button></div>
        <Viewer />
      </div>
      {mediaOverlay && !wide && <button className="workspace-backdrop" aria-label="إغلاق مكتبة المشروع" onClick={() => showPanel('media', false)} />}
      {panels.media && (
        <aside className="workspace-media" aria-label="مكتبة المشروع">
          <div className="panel-heading"><h2>مكتبة المشروع</h2><button className="icon-button" aria-label="إخفاء مكتبة الوسائط" title="إخفاء" onClick={() => showPanel('media', false)}><Icon name="close" /></button></div>
          <MediaPanel />
        </aside>
      )}
    </div>
  );
}

function ToolsPanel({ onClose }: { onClose(): void }) {
  const tab = useStore((s) => s.panel);
  const selected = useStore((s) => s.selected);
  const title = tab === 'assistant' ? 'مساعد المونتاج' : tab === 'text' ? 'المونتاج بالنص' : tab === 'notes' ? 'التعليقات' : selected.length > 1 ? `${selected.length} عناصر محددة` : selected.length ? 'خصائص اللقطة' : 'إعدادات المشروع';
  return (
    <aside className="context-panel">
      <div className="panel-heading"><h2>{title}</h2><button className="icon-button" aria-label="إخفاء لوحة الأدوات" title="إخفاء" onClick={onClose}><Icon name="close" /></button></div>
      <div className="min-h-0 flex-1">{tab === 'assistant' ? <Assistant key={useStore.getState().name} /> : tab === 'text' ? <Transcript /> : tab === 'notes' ? <Notes /> : <Inspector />}</div>
    </aside>
  );
}

/** A remembered split, measured against the actual workspace rather than the viewport. */
function TimelineDock() {
  const maximised = useTimelineView((s) => s.maximised);
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(Math.max(380, innerHeight - 48));
  const [ratio, setRatio] = useState(() => readSplit(available));
  const height = timelineSize(available, ratio, maximised);
  useEffect(() => {
    const parent = ref.current!.parentElement!;
    const ro = new ResizeObserver(() => setAvailable(parent.clientHeight));
    ro.observe(parent); return () => ro.disconnect();
  }, []);
  const change = (next: number, save = true) => {
    const value = timelineSize(available, next / available) / available;
    setRatio(value); if (save) saveSplit(value);
  };
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (maximised) useTimelineView.getState().toggleMax();
    const el = e.currentTarget as HTMLElement, y0 = e.clientY, h0 = height, original = ratio;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => change(h0 + y0 - ev.clientY, false);
    const end = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (ev.type === 'pointercancel') { setRatio(original); if (maximised) useTimelineView.getState().toggleMax(); }
      else change(h0 + y0 - ev.clientY);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };
  return <div ref={ref} className="timeline-dock" data-maximised={maximised || undefined} style={{ height }}>
    <div className="timeline-resizer" role="separator" tabIndex={0} aria-label="ارتفاع التايملاين" aria-orientation="horizontal" aria-valuenow={height} aria-valuemin={160} aria-valuemax={Math.max(160, available - 220)}
      onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); if (maximised) useTimelineView.getState().toggleMax(); change(height + (e.key === 'ArrowUp' ? 30 : -30)); } }}
      onPointerDown={drag} onDoubleClick={() => { if (maximised) useTimelineView.getState().toggleMax(); setRatio(.4); saveSplit(.4); }} title="اسحب لتغيير مساحة المعاينة والتايملاين · دبل كلك يرجّع التقسيم">
      <span aria-hidden="true">⠿</span><span>اسحب لتغيير مساحة التايملاين</span>
    </div>
    <Timeline />
  </div>;
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), toast.kind === 'error' ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !show) return null;
  return (
    <div role={toast.kind === 'error' ? 'alert' : 'status'} className={`app-toast fixed bottom-10 left-1/2 z-[80] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-xl ${toast.kind === 'error' ? 'bg-cut font-semibold text-ink-950' : 'bg-ink-700 text-ink-200'}`}>
      <span>{toast.text}</span><button aria-label="إغلاق التنبيه" onClick={() => setShow(false)}><Icon name="close" /></button>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || e.defaultPrevented) return;
      // in a field: text fields keep their own keys (and their own undo); after a slider, a checkbox or a list was used,
      // focus stays on it, and Ctrl+Z / Ctrl+Shift+Z must still undo the edit it made
      const field = e.target instanceof Element ? e.target.closest('input,textarea,select,[contenteditable]') : null;
      const textual = !!field && (field.tagName === 'TEXTAREA' || field.hasAttribute('contenteditable') || (field instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(field.type)));
      if (textual) return;
      const keys = useKeys.getState();
      const combo = comboOf(e);
      if (!combo) return;
      const action = actionFor(combo);
      // the play key works from anywhere but a text field or an open menu: the button, slider or list used last keeps
      // the focus, and used to take Space for itself (the button ran again, the slider ignored it) — playback "stuck"
      const inMenu = e.target instanceof Element && !!e.target.closest('[role="menu"]');
      const play = action === 'play' && !inMenu;
      if (!action || (field && action !== 'undo' && action !== 'redo' && !play)) return;
      if (play && e.target instanceof Element && e.target.closest('button,a,summary,[role="button"],input,select')) (document.activeElement as HTMLElement | null)?.blur();
      // held down, the key repeats: one press is one toggle
      if (play && e.repeat) { e.preventDefault(); return; }
      // the panels answer their own keys while open
      if (keys.open || useStore.getState().stylesOpen) {
        if (action === 'deselect') { e.preventDefault(); keys.setOpen(false); useStore.getState().setStylesOpen(false); }
        return;
      }
      const s = useStore.getState();
      const p = s.project;
      if (action === 'shortcuts') { e.preventDefault(); return keys.setOpen(true); }
      if (!p) return;
      // text selected on the page (the transcript…): Ctrl+C copies that text, as usual
      if (action === 'copy' && String(window.getSelection() ?? '').trim()) return;
      const fps = p.settings.fps;
      e.preventDefault();
      switch (action) {
        case 'timelineMax': return useTimelineView.getState().toggleMax();
        case 'addMedia': { const { ids } = useMediaSelection.getState(); if (ids.length) return placeMediaRun(ids, s.time); return; }
        case 'nudgeBack': case 'nudgeFwd': case 'nudgeBack10': case 'nudgeFwd10': {
          const clips = p.clips.filter((c) => s.selected.includes(c.id) && c.trackId !== 'V1');
          const delta = (action.includes('Back') ? -1 : 1) * (action.endsWith('10') ? 10 : 1) / fps;
          if (clips.length) return s.ops(freeMoveOps(p, clips, delta));
          return;
        }
        case 'markIn': return s.ops([{ op: 'set_marks', in: s.time }]);
        case 'markOut': return s.ops([{ op: 'set_marks', out: s.time }]);
        case 'clearIn': return s.ops([{ op: 'set_marks', in: null }]);
        case 'clearOut': return s.ops([{ op: 'set_marks', out: null }]);
        case 'clearMarks': return s.ops([{ op: 'set_marks', in: null, out: null }]);
        case 'playMarked': return s.playMarked();
        case 'play': return s.setPlaying(!s.playing);
        case 'frameBack': return s.seek(s.time - 1 / fps);
        case 'frameFwd': return s.seek(s.time + 1 / fps);
        case 'secBack': return s.seek(s.time - 1);
        case 'secFwd': return s.seek(s.time + 1);
        case 'jumpBack': return s.seek(s.time - 5);
        case 'jumpFwd': return s.seek(s.time + 5);
        case 'start': return s.seek(0);
        case 'end': return s.seek(projectDuration(p));
        case 'prevCut': case 'nextCut': {
          const cuts = [0, ...mainClips(p).map((c) => c.start), mainDuration(p)];
          const next = action === 'nextCut' ? cuts.find((c) => c > s.time + 1e-3) : [...cuts].reverse().find((c) => c < s.time - 1e-3);
          if (next !== undefined) s.seek(next);
          return;
        }
        case 'split': {
          // the selected clip, or the main-track clip under the playhead
          const target = p.clips.find((c) => s.selected.includes(c.id) && s.time > c.start && s.time < clipEnd(c)) ?? timelineToSource(p, s.time)?.clip;
          if (target) s.ops([{ op: 'split', clipId: target.id, at: s.time }]);
          return;
        }
        case 'delete':
          // a picked ◆ on the timeline goes first
          if (deleteSelectedKey()) return;
          // focus in the project library: delete the picked files, not timeline clips
          if (e.target instanceof Element && e.target.closest('[data-media-list]')) return removeMedia(useMediaSelection.getState().ids);
          if (s.selected.length) {
            s.ops(deleteOps(s.selected));
            s.select([]);
          } else return s.deleteMarkedRange();
          return;
        case 'deselect': s.setGraphicPick(undefined); useKeySel.setState({ key: undefined }); return s.select([]);
        case 'undo': return s.undo();
        case 'redo': return s.redo();
        case 'comment': return s.startNote();
        case 'addText':
          return s.addTitle();
        case 'zoomIn': return s.setZoom(s.zoom * 1.25);
        case 'zoomOut': return s.setZoom(s.zoom / 1.25);
        case 'zoomFit': return s.setZoom((window.innerWidth - 160) / Math.max(5, projectDuration(p)));
        case 'styles': return s.setStylesOpen(true);
        case 'largeWave': return s.setLargeWave(!s.largeWave);
        case 'magnet': return s.setMagnet(!s.magnet);
        case 'copyLook': return s.copyLook();
        case 'pasteLook': return s.pasteLook();
        case 'copy': return s.copyClips();
        case 'paste': return s.pasteClips();
        case 'duplicate': return s.duplicateClips();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

