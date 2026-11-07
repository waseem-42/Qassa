import { CAPTION_TRACK } from './captions.ts';
import type { Op } from './ops.ts';
import { MAIN_TRACK, type Grade, type Project, type TextStyle, type Theme, type Transition } from './schema.ts';

// A style is a whole look in one click: the theme (text presets, graphic templates), a colour
// grade, how captions look, and optionally a transition for the cuts. The library below is
// distilled from the reference projects (HyperFrames' design templates, lemo-opuscar's film styles,
// gbro's paper collage, onetake's continuous motion); users save their own next to it.

export interface StyleDef {
  id: string;
  name: string;
  description: string;
  /** where the idea comes from (shown on the card) */
  inspiredBy?: string;
  tags?: string[];
  theme: Partial<Theme>;
  grade?: Partial<Grade>;
  captions?: Partial<TextStyle>;
  transition?: Transition;
}

export const STYLE_PRESETS: StyleDef[] = [
  {
    id: 'classic-dark', name: 'داكن كلاسيك', description: 'لوحات داكنة ولمسة ذهبية — يناسب أغلب الشروحات والبودكاست.', tags: ['شرح', 'بودكاست'],
    theme: { accent: '#f2b33d', accent2: '#5ec2ff', panel: 'rgba(14,16,24,0.88)', text: '#ffffff', direction: 'auto' },
    captions: { size: 46, weight: 600, color: '#ffffff', background: 'rgba(0,0,0,0.62)' },
  },
  {
    id: 'keynote-light', name: 'عرض تقديمي فاتح', description: 'بطاقات بيضاء ونص داكن وأزرق هادي — شرح منظم زي عروض الكينوت.', inspiredBy: 'lemo-opuscar · Information & Keynote', tags: ['شرح', 'تعليمي'],
    theme: { accent: '#2563eb', accent2: '#db2777', panel: 'rgba(255,255,255,0.94)', text: '#111827' },
    grade: { exposure: 0.03, contrast: 1.03, saturation: 1.02 },
    captions: { size: 44, weight: 600, color: '#111827', background: 'rgba(255,255,255,0.9)' },
  },
  {
    id: 'bold-poster', name: 'بوستر جريء', description: 'أصفر صارخ على أسود ونص عريض — لافت للانتباه، للإعلانات والمقدمات.', inspiredBy: 'HyperFrames · Bold Poster / Biennale Yellow', tags: ['إعلان', 'شورتس'],
    theme: { accent: '#ffd400', accent2: '#ff3b30', panel: 'rgba(10,10,10,0.92)', text: '#ffffff' },
    grade: { contrast: 1.12, saturation: 1.1 },
    captions: { size: 58, weight: 700, color: '#0a0a0a', background: '#ffd400' },
    transition: { kind: 'flash', duration: 0.3 },
  },
  {
    id: 'blue-pro', name: 'أزرق احترافي', description: 'كحلي وسماوي، رسمي ونظيف — للشركات والمحتوى التقني.', inspiredBy: 'HyperFrames · Blue Professional / Cobalt Grid', tags: ['شركات', 'تقني'],
    theme: { accent: '#38bdf8', accent2: '#a3e635', panel: 'rgba(8,22,48,0.9)', text: '#f1f5f9' },
    grade: { contrast: 1.04, saturation: 0.96, temperature: 6800 },
    captions: { size: 44, weight: 600, color: '#f1f5f9', background: 'rgba(8,22,48,0.85)' },
    transition: { kind: 'crossfade', duration: 0.4 },
  },
  {
    id: 'paper-collage', name: 'كولاج ورقي', description: 'ألوان ورق مسطحة (خردلي، عنابي) ونص أسود — تحريري وفني.', inspiredBy: 'gbro-collage-broll · halftone paper collage', tags: ['فني', 'قصصي'],
    theme: { accent: '#d9a21b', accent2: '#b3261e', panel: 'rgba(242,233,214,0.96)', text: '#1c1a17' },
    grade: { contrast: 1.06, saturation: 0.85, temperature: 5600, gamma: 1.03 },
    captions: { size: 46, weight: 700, color: '#1c1a17', background: 'rgba(242,233,214,0.95)' },
    transition: { kind: 'wipe', duration: 0.4 },
  },
  {
    id: 'neon-tech', name: 'نيون تقني', description: 'سماوي وبنفسجي متوهج على خلفية شبه سوداء — للتقنية والألعاب.', tags: ['تقني', 'ألعاب'],
    theme: { accent: '#22d3ee', accent2: '#a78bfa', panel: 'rgba(10,10,22,0.82)', text: '#f8fafc' },
    grade: { contrast: 1.1, saturation: 1.18, temperature: 7600 },
    captions: { size: 48, weight: 700, color: '#f8fafc', background: 'rgba(10,10,22,0.75)' },
    transition: { kind: 'zoom', duration: 0.35 },
  },
  {
    id: 'cinematic-warm', name: 'سينمائي دافئ', description: 'ألوان دافئة وتباين ناعم ونص خفيف — للفلوقات والقصص.', inspiredBy: 'lemo-opuscar · Cinema & Eras', tags: ['فلوق', 'قصصي'],
    theme: { accent: '#f59e0b', accent2: '#fb7185', panel: 'rgba(24,16,10,0.7)', text: '#fff7ed' },
    grade: { contrast: 1.08, saturation: 0.9, temperature: 5200, gamma: 0.97 },
    captions: { size: 42, weight: 500, color: '#fff7ed', background: 'rgba(0,0,0,0)' },
    transition: { kind: 'dip', duration: 0.8 },
  },
  {
    id: 'documentary', name: 'وثائقي', description: 'محايد وجاد بلمسة حمراء — للتقارير والمحتوى المبني على أدلة.', inspiredBy: 'lemo-opuscar · Edit & Documentary / Evidence Films', tags: ['تقارير', 'وثائقي'],
    theme: { accent: '#e11d48', accent2: '#e5e7eb', panel: 'rgba(17,17,17,0.85)', text: '#fafafa' },
    grade: { contrast: 1.05, saturation: 0.82 },
    captions: { size: 42, weight: 500, color: '#fafafa', background: 'rgba(0,0,0,0.55)' },
    transition: { kind: 'crossfade', duration: 0.6 },
  },
  {
    id: 'coral-soft', name: 'مرجاني ناعم', description: 'مرجاني ووردي على كريمي — دافئ وودود، لايف ستايل وطبخ.', inspiredBy: 'HyperFrames · Coral / Capsule', tags: ['لايف ستايل'],
    theme: { accent: '#ff6b5b', accent2: '#ffb4a2', panel: 'rgba(255,246,240,0.95)', text: '#3a2420' },
    grade: { exposure: 0.04, saturation: 1.05, temperature: 6000 },
    captions: { size: 46, weight: 600, color: '#3a2420', background: 'rgba(255,246,240,0.92)' },
    transition: { kind: 'crossfade', duration: 0.5 },
  },
  {
    id: 'mono-contrast', name: 'أبيض وأسود', description: 'تباين عالي بدون ألوان — حاد ومركّز.', tags: ['فني', 'بسيط'],
    theme: { accent: '#ffffff', accent2: '#9ca3af', panel: 'rgba(0,0,0,0.9)', text: '#ffffff' },
    grade: { contrast: 1.2, saturation: 0 },
    captions: { size: 46, weight: 700, color: '#ffffff', background: 'rgba(0,0,0,0.8)' },
  },
  {
    id: 'shorts-loud', name: 'شورتس صاخب', description: 'كابشن كبير في نص الشاشة بخلفية صفراء وانتقالات سريعة — للمقاطع العمودية.', tags: ['شورتس', 'عمودي'],
    theme: { accent: '#facc15', accent2: '#22c55e', panel: 'rgba(0,0,0,0.85)', text: '#ffffff' },
    grade: { contrast: 1.1, saturation: 1.15 },
    captions: { size: 72, weight: 700, color: '#111111', background: '#facc15', y: 0.62 },
    transition: { kind: 'slide', duration: 0.3 },
  },
];

export interface ApplyStyleOptions {
  /** restyle the caption track already on the timeline (new captions always use the style) */
  captions?: boolean;
  /** put the style's transition on every cut of the main track */
  transitions?: boolean;
}

/** Ops that apply a style to a project. `lut` = a project-relative LUT already copied in, if the style has one. */
export function styleOps(p: Project, s: Pick<StyleDef, 'theme' | 'grade' | 'captions' | 'transition'>, o: ApplyStyleOptions = {}, lut?: string): Op[] {
  const ops: Op[] = [{ op: 'set_settings', patch: { theme: s.theme, captionStyle: s.captions ?? null } }];
  const grade = s.grade ? { ...s.grade, ...(lut ? { lut } : {}) } : undefined;
  // the style's grade replaces the old default entirely (a stale LUT from another look would linger otherwise)
  ops.push({ op: 'set_settings', patch: { defaultGrade: null } });
  if (grade) ops.push({ op: 'set_grade', asDefault: true, grade });
  if (o.captions && s.captions) {
    for (const c of p.clips.filter((x) => x.trackId === CAPTION_TRACK && x.text)) {
      ops.push({ op: 'update_clip', clipId: c.id, patch: { textStyle: { ...s.captions, background: s.captions.background ?? null } } });
    }
  }
  if (o.transitions) {
    const ids = p.clips.filter((c) => c.trackId === MAIN_TRACK).sort((a, b) => a.start - b.start).slice(1).map((c) => c.id);
    if (ids.length) ops.push({ op: 'set_transition', clipIds: ids, kind: s.transition?.kind ?? null, duration: s.transition?.duration });
  }
  return ops;
}
