import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTIONS, keysFor, prettyKey, useKeys, type ActionId } from '../lib/keys.ts';
import { runAction } from '../lib/actions.ts';
import { score, useHeaderDialog, usePalette } from '../lib/palette.ts';
import { useStore } from '../lib/store.ts';
import { importFiles } from '../lib/import.ts';
import { useRuntime } from './RuntimeSettings.tsx';
import { Icon } from './Brand.tsx';

// The command search (Ctrl+K): every shortcut action plus the windows and project commands, found by typing —
// Arabic is folded (أ/ا, ة/ه…) and English words work too, so nobody has to know where a button lives.

interface Command { id: string; label: string; group: string; keys?: string[]; words?: string; run(): unknown }

/** extra words people type for an action (English, colloquial) */
const WORDS: Partial<Record<ActionId, string>> = {
  split: 'split cut razor قطع تقطيع شق', delete: 'remove مسح شيل ازاله', trimStart: 'trim ripple delete left قص بدايه', trimEnd: 'trim ripple delete right قص نهايه',
  undo: 'undo رجوع تراجع', redo: 'redo', addText: 'text title عنوان كتابه', comment: 'comment note ملاحظه', play: 'play pause تشغيل ايقاف',
  markIn: 'in mark علامه بدايه جزء التصدير', markOut: 'out mark علامه نهايه جزء التصدير', copy: 'copy', paste: 'paste', duplicate: 'duplicate نسخه',
  zoomIn: 'zoom تكبير', zoomOut: 'zoom تصغير', zoomFit: 'fit ملاءمه الكل', magnet: 'snap magnet التصاق', styles: 'styles look lut الوان ستايل',
  shortcuts: 'keys shortcuts keyboard اختصار', timelineMax: 'timeline expand', largeWave: 'waveform audio موجه', addMedia: 'insert add place ضع', rate: 'speed playback fast سرعه اسرع مراجعه',
};
const RECENT_KEY = 'qassa.palette-recent';
const loadRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 5) : []; } catch { return []; } };
const saveRecent = (ids: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 5))); } catch { /* this session only */ } };

function pickFiles() {
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
  input.onchange = () => { if (input.files?.length) importFiles([...input.files]); };
  input.click();
}

function useCommands(): Command[] {
  const custom = useKeys((s) => s.custom);
  const projects = useStore((s) => s.projects), name = useStore((s) => s.name), aspect = useStore((s) => s.project?.settings.aspect);
  return useMemo(() => {
    const s = () => useStore.getState(), dialog = useHeaderDialog.getState().setDialog;
    const list: Command[] = [
      { id: 'export', label: 'تصدير الفيديو', group: 'المشروع', words: 'export render download save mp4 حفظ تنزيل', run: () => { s().setPlaying(false); dialog('export'); } },
      { id: 'review', label: 'مراجعة المونتاج قبل التصدير', group: 'المشروع', words: 'review check فحص اخطاء', run: () => { s().setPlaying(false); dialog('export'); } },
      { id: 'import', label: 'استيراد ملفات', group: 'المشروع', words: 'import add files upload media اضف ملفات رفع', run: pickFiles },
      { id: 'checkpoints', label: 'نقاط الحفظ', group: 'المشروع', words: 'checkpoint backup version نسخه احتياطيه', run: () => dialog('checkpoints') },
      { id: 'jobs', label: 'المهام (التحليل والتصدير)', group: 'المشروع', words: 'jobs tasks progress', run: () => dialog('jobs') },
      { id: 'home', label: 'العودة إلى كل المشاريع', group: 'المشروع', words: 'home projects back رئيسيه', run: () => s().close() },
      { id: 'settings', label: 'الإعدادات', group: 'المشروع', words: 'settings preferences اعدادات', run: () => useRuntime.getState().setOpen(true) },
      { id: 'p-assistant', label: 'مساعد AI', group: 'اللوحات', words: 'ai assistant claude ذكاء مساعد اقتراحات سكتات', run: () => s().setPanel('assistant') },
      { id: 'p-text', label: 'المونتاج بالنص', group: 'اللوحات', words: 'transcript text edit تفريغ كلام', run: () => s().setPanel('text') },
      { id: 'p-inspect', label: 'خصائص اللقطة', group: 'اللوحات', words: 'inspector properties خصائص', run: () => s().setPanel('inspect') },
      { id: 'p-notes', label: 'التعليقات', group: 'اللوحات', words: 'comments notes تعليقات ملاحظات', run: () => s().setPanel('notes') },
      { id: 'p-media', label: 'مكتبة المشروع', group: 'اللوحات', words: 'media library files وسائط مكتبه', run: () => s().showPanel('media', true) },
      ...(['16:9', '9:16', '1:1', '4:5'] as const).filter((a) => a !== aspect).map((a) => ({
        id: `aspect-${a}`, label: `مقاس الفيديو ${a} — ${({ '16:9': 'يوتيوب', '9:16': 'شورتس / ريلز', '1:1': 'مربع', '4:5': 'انستقرام' })[a]}`, group: 'المشروع',
        words: `aspect ratio size vertical horizontal مقاس عمودي افقي ${a === '9:16' ? 'tiktok reels shorts تيك توك' : ''}`, run: () => s().ops([{ op: 'set_settings', patch: { aspect: a } }]),
      })),
      ...ACTIONS.filter((a) => a.id !== 'palette' && a.id !== 'deselect').map((a) => ({ id: a.id, label: a.label, group: a.group, keys: keysFor(a.id, custom), words: WORDS[a.id], run: () => runAction(a.id) })),
      ...projects.filter((p) => p.name !== name).map((p) => ({ id: `open-${p.name}`, label: `افتح مشروع «${p.displayName || p.name}»`, group: 'المشاريع', words: `open project ${p.name}`, run: () => s().open(p.name) })),
    ];
    return list;
  }, [custom, projects, name, aspect]);
}

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const project = useStore((s) => s.project);
  if (!open || !project) return null;
  return <Palette />;
}

function Palette() {
  const close = () => usePalette.getState().setOpen(false);
  const commands = useCommands();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState(loadRecent);
  const ref = useRef<HTMLDialogElement>(null), list = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const results = useMemo(() => {
    if (!query.trim()) {
      const first = recent.map((id) => commands.find((c) => c.id === id)).filter((c): c is Command => !!c).map((c) => ({ ...c, group: 'استخدمتها مؤخرًا' }));
      return [...first, ...commands.filter((c) => !recent.includes(c.id))];
    }
    return commands.map((c) => ({ c, n: Math.max(score(c.label, query) * 2, score(`${c.label} ${c.words ?? ''} ${c.group}`, query)) }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 40).map((x) => x.c);
  }, [query, commands, recent]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const run = (c: Command) => {
    saveRecent([c.id, ...recent.filter((id) => id !== c.id)]);
    returnFocus.current = null;
    close();
    // after the dialog is gone: actions that open dialogs or focus fields get the page back first
    requestAnimationFrame(() => { Promise.resolve(c.run()).catch((e) => useStore.getState().notify((e as Error).message)); });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); run(results[active]); }
  };
  let lastGroup = '';
  return <dialog ref={ref} dir="rtl" className="command-palette" aria-label="ابحث عن أمر"
    onCancel={(e) => { e.preventDefault(); close(); const t = returnFocus.current; requestAnimationFrame(() => { if (t?.isConnected) t.focus({ preventScroll: true }); }); }}
    onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className="command-search">
      <Icon name="search" size={18} />
      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="ابحث عن أمر… مثل: قص، نص، تصدير، شورتس" aria-label="ابحث عن أمر"
        role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined} />
      <kbd>Esc</kbd>
    </div>
    <div ref={list} id="command-results" className="command-results" role="listbox" aria-label="الأوامر">
      {!results.length && <p className="command-empty">ما لقيت أمرًا بهذا الاسم. جرّب كلمة ثانية، أو اضغط <kbd>?</kbd> لكل الاختصارات.</p>}
      {results.map((c, i) => {
        const header = c.group !== lastGroup ? (lastGroup = c.group) : undefined;
        return <div key={`${c.group}-${c.id}`}>
          {header && <div className="command-group" role="presentation">{header}</div>}
          <div id={`cmd-${c.id}`} role="option" aria-selected={i === active} data-active={i === active} className="command-item" onMouseMove={() => setActive(i)} onClick={() => run(c)}>
            <span>{c.label}</span>
            {!!c.keys?.length && <span className="command-keys" dir="ltr">{(c.keys[0] === '+' ? ['+'] : c.keys[0].split('+')).map((k, j) => <kbd key={j}>{prettyKey(k)}</kbd>)}</span>}
          </div>
        </div>;
      })}
    </div>
    <footer className="command-foot"><span><kbd>↑</kbd><kbd>↓</kbd> للتنقل</span><span><kbd>Enter</kbd> للتنفيذ</span><span className="mr-auto">{results.length} أمر</span></footer>
  </dialog>;
}
