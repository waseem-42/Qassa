import { create } from 'zustand';

// Every keyboard shortcut lives here: the shortcuts panel lists and rebinds them, the key handler
// in App.tsx looks actions up by the pressed combo. Rebinds are kept per browser.

export type ActionId =
  | 'quickExport' | 'openExport'
  | 'markIn' | 'markOut' | 'clearIn' | 'clearOut' | 'clearMarks' | 'playMarked' | 'timelineMax' | 'nudgeBack' | 'nudgeFwd' | 'nudgeBack10' | 'nudgeFwd10' | 'addMedia'
  | 'play' | 'frameBack' | 'frameFwd' | 'secBack' | 'secFwd' | 'jumpBack' | 'jumpFwd' | 'start' | 'end' | 'prevCut' | 'nextCut'
  | 'split' | 'delete' | 'deselect' | 'undo' | 'redo' | 'comment' | 'addText' | 'zoomIn' | 'zoomOut' | 'zoomFit' | 'shortcuts' | 'styles' | 'largeWave' | 'magnet' | 'copyLook' | 'pasteLook' | 'copy' | 'paste' | 'duplicate' | 'trimStart' | 'trimEnd' | 'palette' | 'rate';

export interface Action { id: ActionId; label: string; group: string; keys: string[] }

export const ACTIONS: Action[] = [
  { id: 'quickExport', label: 'تصدير بالإعدادات الأخيرة', group: 'المشروع', keys: ['Ctrl+E'] },
  { id: 'openExport', label: 'إعدادات التصدير', group: 'المشروع', keys: ['Ctrl+Shift+E'] },
  { id: 'timelineMax', label: 'تكبير مساحة التايملاين / استعادة', group: 'العرض', keys: ['Shift+F'] },
  { id: 'nudgeBack', label: 'تحريك المحدد فريم للخلف', group: 'التعديل', keys: [','] },
  { id: 'nudgeFwd', label: 'تحريك المحدد فريم للأمام', group: 'التعديل', keys: ['.'] },
  { id: 'nudgeBack10', label: 'تحريك المحدد 10 فريم للخلف', group: 'التعديل', keys: ['Shift+,'] },
  { id: 'nudgeFwd10', label: 'تحريك المحدد 10 فريم للأمام', group: 'التعديل', keys: ['Shift+.'] },
  { id: 'addMedia', label: 'إضافة الوسيط المحدد عند المؤشر', group: 'التعديل', keys: ['Shift+A'] },
  { id: 'markIn', label: 'علامة البداية In', group: 'العلامات', keys: ['I'] },
  { id: 'markOut', label: 'علامة النهاية Out', group: 'العلامات', keys: ['O'] },
  { id: 'clearIn', label: 'مسح علامة البداية', group: 'العلامات', keys: ['Alt+I'] },
  { id: 'clearOut', label: 'مسح علامة النهاية', group: 'العلامات', keys: ['Alt+O'] },
  { id: 'clearMarks', label: 'مسح العلامتين', group: 'العلامات', keys: ['Alt+X'] },
  { id: 'playMarked', label: 'تشغيل من In إلى Out', group: 'العلامات', keys: ['Shift+Space'] },
  { id: 'play', label: 'تشغيل / إيقاف', group: 'التشغيل', keys: ['Space'] },
  { id: 'frameBack', label: 'فريم للخلف', group: 'التشغيل', keys: ['ArrowLeft'] },
  { id: 'frameFwd', label: 'فريم للأمام', group: 'التشغيل', keys: ['ArrowRight'] },
  { id: 'secBack', label: 'ثانية للخلف', group: 'التشغيل', keys: ['Shift+ArrowLeft'] },
  { id: 'secFwd', label: 'ثانية للأمام', group: 'التشغيل', keys: ['Shift+ArrowRight'] },
  { id: 'jumpBack', label: '5 ثواني للخلف', group: 'التشغيل', keys: ['J'] },
  { id: 'jumpFwd', label: '5 ثواني للأمام', group: 'التشغيل', keys: ['L'] },
  { id: 'rate', label: 'سرعة المعاينة ×1 / ×1.5 / ×2', group: 'التشغيل', keys: ['Shift+R'] },
  { id: 'start', label: 'البداية', group: 'التشغيل', keys: ['Home'] },
  { id: 'end', label: 'النهاية', group: 'التشغيل', keys: ['End'] },
  { id: 'prevCut', label: 'القصة اللي قبل', group: 'التشغيل', keys: ['ArrowUp'] },
  { id: 'nextCut', label: 'القصة اللي بعد', group: 'التشغيل', keys: ['ArrowDown'] },
  { id: 'split', label: 'قص عند المؤشر', group: 'التعديل', keys: ['S'] },
  { id: 'trimStart', label: 'احذف ما قبل المؤشر من اللقطة', group: 'التعديل', keys: ['Q'] },
  { id: 'trimEnd', label: 'احذف ما بعد المؤشر من اللقطة', group: 'التعديل', keys: ['W'] },
  { id: 'delete', label: 'حذف المحدد', group: 'التعديل', keys: ['Delete', 'Backspace'] },
  { id: 'deselect', label: 'إلغاء التحديد', group: 'التعديل', keys: ['Escape'] },
  { id: 'undo', label: 'تراجع', group: 'التعديل', keys: ['Ctrl+Z'] },
  { id: 'redo', label: 'إعادة', group: 'التعديل', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'comment', label: 'تعليق عند المؤشر', group: 'التعديل', keys: ['C'] },
  { id: 'addText', label: 'نص عند المؤشر', group: 'التعديل', keys: ['T'] },
  { id: 'copy', label: 'نسخ اللقطات المحددة', group: 'التعديل', keys: ['Ctrl+C'] },
  { id: 'paste', label: 'لصق اللقطات عند المؤشر', group: 'التعديل', keys: ['Ctrl+V'] },
  { id: 'duplicate', label: 'تكرار المحدد بعده مباشرة', group: 'التعديل', keys: ['Ctrl+D'] },
  { id: 'copyLook', label: 'نسخ خصائص اللقطة', group: 'التعديل', keys: ['Ctrl+Alt+C'] },
  { id: 'pasteLook', label: 'لصق الخصائص على المحدد', group: 'التعديل', keys: ['Ctrl+Alt+V'] },
  { id: 'magnet', label: 'المغناطيس (Alt أثناء السحب يوقفه مؤقتًا)', group: 'التعديل', keys: ['N'] },
  { id: 'largeWave', label: 'موجة صوت كبيرة', group: 'العرض', keys: ['Shift+W'] },
  { id: 'zoomIn', label: 'تكبير التايملاين', group: 'العرض', keys: ['=', '+'] },
  { id: 'zoomOut', label: 'تصغير التايملاين', group: 'العرض', keys: ['-'] },
  { id: 'zoomFit', label: 'التايملاين كامل', group: 'العرض', keys: ['Shift+Z'] },
  { id: 'shortcuts', label: 'الاختصارات', group: 'العرض', keys: ['?'] },
  { id: 'palette', label: 'ابحث عن أمر', group: 'العرض', keys: ['Ctrl+K'] },
  { id: 'styles', label: 'الستايلات', group: 'العرض', keys: ['Shift+S'] },
];

/**
 * The combo string of a key event: modifiers in a fixed order, then the key. Letters and digits come
 * from the physical key (e.code), so S is S on an Arabic layout too (where it types «س»).
 */
export function comboOf(e: KeyboardEvent): string {
  const physical = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.code === 'Comma' ? ',' : e.code === 'Period' ? '.' : undefined;
  const k = physical ?? (e.key === ' ' ? 'Space' : e.key === '؟' ? '?' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  // a typed symbol already carries its Shift ('?', '+'): don't add it again
  const shift = e.shiftKey && (!!physical || e.key.length > 1 || e.code === 'Space');
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', shift ? 'Shift' : '', k].filter(Boolean).join('+');
}

const STORE_KEY = 'edit-tool-keys';
function loadCustom(): Partial<Record<ActionId, string[]>> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}

interface KeyState {
  custom: Partial<Record<ActionId, string[]>>;
  open: boolean;
  setOpen(open: boolean): void;
  bind(id: ActionId, keys: string[]): void;
  reset(id?: ActionId): void;
}

export const useKeys = create<KeyState>((set, get) => ({
  custom: loadCustom(),
  open: false,
  setOpen: (open) => set({ open }),
  bind(id, keys) {
    // a combo belongs to one action: take it away from any other
    const custom = { ...get().custom };
    for (const a of ACTIONS) {
      if (a.id === id) continue;
      const cur = custom[a.id] ?? a.keys;
      if (cur.some((k) => keys.includes(k))) custom[a.id] = cur.filter((k) => !keys.includes(k));
    }
    custom[id] = keys;
    save(custom);
    set({ custom });
  },
  reset(id) {
    const custom = { ...get().custom };
    if (id) delete custom[id]; else for (const k of Object.keys(custom)) delete custom[k as ActionId];
    save(custom);
    set({ custom });
  },
}));

function save(custom: Partial<Record<ActionId, string[]>>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(custom)); } catch { /* private mode: this session only */ }
}

export const keysFor = (id: ActionId, custom = useKeys.getState().custom) => custom[id] ?? ACTIONS.find((a) => a.id === id)!.keys;

/** combo -> action, with the user's rebinds applied */
export function actionFor(combo: string, custom = useKeys.getState().custom): ActionId | undefined {
  return ACTIONS.find((a) => keysFor(a.id, custom).includes(combo))?.id;
}

/** "Ctrl+Shift+Z" → display chips text */
export const prettyKey = (k: string) =>
  k.replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('Space', 'مسافة').replace('Escape', 'Esc');

export function shortcutTitle(label: string, id: ActionId, custom = useKeys.getState().custom): string {
  const keys = keysFor(id, custom).map(prettyKey).join(' / ');
  return keys ? `${label} (${keys})` : label;
}

/** Spatial navigation inside the library grid (Enter is the button's native activation). */
export function galleryStep(key: string, columns: number, rtl: boolean): number | undefined {
  return ({ ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -columns, ArrowDown: columns } as Record<string, number>)[key];
}

export function navigateGallery(grid: HTMLElement, target: EventTarget | null, key: string, selector = '.style-tile-open'): boolean {
  const buttons = [...grid.querySelectorAll<HTMLButtonElement>(selector)];
  const index = buttons.indexOf(target as HTMLButtonElement);
  if (index < 0) return false;
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const step = galleryStep(key, columns, getComputedStyle(grid).direction === 'rtl');
  if (step === undefined) return false;
  buttons[Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
  return true;
}
