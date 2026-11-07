import { clipEnd, fmtTime, markedRange } from '@edit/shared';
import { useStore } from '../lib/store.ts';
import { Modal } from './Modal.tsx';

export function RangeDeleteHint() {
  const project = useStore((s) => s.project), open = useStore((s) => s.rangeDeletePrompt);
  const range = project && markedRange(project);
  if (!open || !project || !range) return null;
  const count = project.clips.filter((c) => c.start < range[1] && clipEnd(c) > range[0]).length;
  return <Modal title="حذف النطاق من جميع المسارات" subtitle={`${fmtTime(range[0], 1)} — ${fmtTime(range[1], 1)}`} onClose={() => useStore.setState({ rangeDeletePrompt: false })}>
    <div className="modal-body space-y-3"><p className="text-sm leading-7 text-ink-300">يحذف هذا الوقت من المونتاج عبر جميع المسارات، ويقرّب ما بعده. يلمس {count} لقطة. يمكنك التراجع بخطوة واحدة.</p><p className="text-xs text-ink-400">عندما لا تحدد لقطة، Delete يحذف نطاق I/O. يظهر هذا التنبيه قبل أول استخدام.</p>
      <button className="btn btn-danger" onClick={() => useStore.getState().deleteMarkedRange(true)}>حذف النطاق</button>
    </div>
  </Modal>;
}
