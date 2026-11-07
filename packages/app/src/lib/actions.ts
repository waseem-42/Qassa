import { clipEnd, freeMoveOps, mainClips, mainDuration, projectDuration, timelineToSource } from '@edit/shared';
import { useStore } from './store.ts';
import { useKeys, type ActionId } from './keys.ts';
import { useTimelineView } from './timeline-view.ts';
import { placeMediaRun, removeMedia, useMediaSelection } from './import.ts';
import { deleteOps } from './layout.ts';
import { trimToPlayhead } from './trim-playhead.ts';
import { usePalette } from './palette.ts';
import { deleteSelectedKey, useKeySel } from '../components/Timeline.tsx';

/** Runs one shortcut action — from its key (App.tsx) or from the command search. `target` is the focused element. */
export function runAction(action: ActionId, target?: EventTarget | null): unknown {
  const s = useStore.getState();
  const p = s.project;
  if (action === 'shortcuts') return useKeys.getState().setOpen(true);
  if (!p) return;
  const fps = p.settings.fps;
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
      if (target instanceof Element && target.closest('[data-media-list]')) return removeMedia(useMediaSelection.getState().ids);
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
    case 'trimStart': case 'trimEnd': {
      const plan = trimToPlayhead(p, s.selected, s.time, action === 'trimStart' ? 'start' : 'end');
      if (!plan) return s.notify('ضع المؤشر داخل لقطة أولًا', 'info');
      return s.ops(plan.ops).then((ok) => { if (ok && plan.seek !== undefined) s.seek(plan.seek); });
    }
    case 'palette': return usePalette.getState().setOpen(true);
    case 'rate': return s.cycleRate();
  }
}
