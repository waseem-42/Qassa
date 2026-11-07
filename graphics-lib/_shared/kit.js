// Helpers for library templates. Load after /api/graphics/runtime.js (which sets window.GRAPHIC).
(() => {
  const g = window.GRAPHIC || { duration: 6, data: {}, theme: {} };
  const theme = g.theme || {};
  const root = document.documentElement;
  root.style.setProperty('--d', `${g.duration || 6}s`);
  const vars = { accent: '--accent', accent2: '--accent-2', panel: '--panel', text: '--text', font: '--font' };
  for (const [k, v] of Object.entries(vars)) if (theme[k]) root.style.setProperty(v, k === 'font' ? `'${theme[k]}'` : theme[k]);

  // direction: the theme's, or from the first strong letter in the template's text
  const strings = [];
  const collect = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
  collect(g.data || {});
  const first = strings.join(' ').match(/\p{L}/u);
  const dir = theme.direction && theme.direction !== 'auto' ? theme.direction
    : first && /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u.test(first[0]) ? 'rtl' : 'ltr';
  root.dir = dir;

  const kit = {
    data: g.data || {},
    duration: g.duration || 6,
    dir,
    /** 'start' | 'end' (reading sides) or 'left' | 'right' → a physical side */
    side(pos, fallback = 'start') {
      const p = pos || fallback;
      if (p === 'left' || p === 'right' || p === 'center') return p;
      return (p === 'start') === (dir === 'rtl') ? 'right' : 'left';
    },
    /** `edit` names the element for hand edits in the editor (they stay on it when the data changes) */
    el(tag, cls, text, edit) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = String(text);
      if (edit) e.dataset.edit = edit;
      return e;
    },
    /** The page's scenes [[name, start], …] (page seconds) for the editor's scene lengths; the exit is added. */
    scenes(list) {
      const exit = kit.duration - 0.35;
      window.__graphicScenes = [...list.filter(([, s]) => s < exit - 0.1).map(([name, start]) => ({ name, start })), { name: 'الخروج', start: exit }];
    },
    /** n delays spread between `from` and the moment the exit starts, at most `max` apart */
    stagger(n, from = 0.5, max = 1.2) {
      const room = Math.max(0.2, kit.duration - 0.6 - from - 0.8);
      const step = n > 1 ? Math.min(max, room / (n - 1)) : 0;
      return Array.from({ length: n }, (_, i) => from + i * step);
    },
    delay(e, s) { e.style.animationDelay = `${s}s`; return e; },
  };
  window.kit = kit;
})();
