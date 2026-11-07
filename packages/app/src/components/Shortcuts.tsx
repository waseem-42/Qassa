import { useEffect, useState } from 'react';
import { ACTIONS, comboOf, keysFor, prettyKey, useKeys, type ActionId } from '../lib/keys.ts';
import { Modal } from './Modal.tsx';

// The keyboard shortcuts panel: every action with its keys; click a key to record a new one.

export function Shortcuts() {
  const open = useKeys((s) => s.open);
  const custom = useKeys((s) => s.custom);
  const { setOpen, bind, reset } = useKeys.getState();
  const [recording, setRecording] = useState<ActionId>();

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(undefined);
      const combo = comboOf(e);
      if (!combo) return; // a lone modifier: wait for the key
      bind(recording, [combo]);
      setRecording(undefined);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, bind]);

  if (!open) return null;
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  return (
    <Modal title="اختصارات لوحة المفاتيح" subtitle="اضغط على أي اختصار لتغييره. تعمل على لوحة المفاتيح العربية والإنجليزية." wide onClose={() => setOpen(false)}>
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-3">
          <div className="flex-1" />
          {Object.keys(custom).length > 0 && <button className="btn btn-ghost h-7 text-xs" onClick={() => reset()}>رجّع الكل للافتراضي</button>}
        </div>
        <div className="grid min-h-0 grid-cols-1 sm:grid-cols-2 gap-x-6 overflow-y-auto p-4">
          {groups.map((g) => (
            <div key={g} className="mb-4">
              <div className="panel-title mb-2">{g}</div>
              {ACTIONS.filter((a) => a.group === g).map((a) => {
                const keys = keysFor(a.id, custom);
                const changed = !!custom[a.id];
                return (
                  <div key={a.id} className="flex items-center gap-2 border-b border-ink-850 py-1.5 text-sm">
                    <span className="flex-1 text-ink-200">{a.label}</span>
                    {recording === a.id ? (
                      <span className="animate-pulse rounded border border-accent px-2 py-0.5 text-xs text-accent">اضغط الاختصار الجديد… (Esc للإلغاء)</span>
                    ) : (
                      <button className="flex gap-1" onClick={() => setRecording(a.id)} title="اضغط للتغيير">
                        {keys.length ? keys.map((k) => (
                          <span key={k} className="flex items-center gap-0.5 rounded px-0.5 hover:bg-ink-800" dir="ltr">
                            {/* one box per key: "Shift" "←" rather than "Shift+←" */}
                            {(k === '+' ? ['+'] : k.split('+')).map((part, i) => (
                              <kbd key={i} className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-200">{prettyKey(part)}</kbd>
                            ))}
                          </span>
                        )) : <span className="text-xs text-ink-500">بدون — اضغط للتعيين</span>}
                      </button>
                    )}
                    {changed && <button className="text-[11px] text-ink-500 hover:text-ink-300" title="رجّع الافتراضي" onClick={() => reset(a.id)}>↺</button>}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="sm:col-span-2 text-xs leading-6 text-ink-500">
            بالماوس: اسحب خط المؤشر أو رأسه، أو انقر المسطرة لتحريكه بالمغناطيس · اسحب مقابض I/O من السطر العلوي لضبط التصدير، أو استخدم I وO · Alt يفك المغناطيس أثناء السحب · اسحب الفراغ لتحديد اللقطات (Shift يضيف، Ctrl يبدّل)، ثم اسحب التحديد لتحريكه معًا؛ Esc يلغي السحب · اسحب بين صفين لإضافة طبقة · Ctrl+عجلة الماوس للتكبير، Ctrl+Shift+العجلة لحجم المسارات · دبل كلك اسم المسار لتسميته، ومصغّر الفيديو لاختيار جزء منه · سحب النص أو الرسمة على الفيديو يحرّكها · دبل كلك في مسار التعليقات يضيف تعليق.
          </div>
        </div>
      </div>
    </Modal>
  );
}
