import { TextStyle, Theme, type Clip } from './schema.ts';

// One text layer, rendered identically in the editor preview (inside a scaled frame) and in
// the headless browser that produces the overlay PNG for ffmpeg.

export const FONT_STACK = `'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, sans-serif`;

const RTL_CHAR = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const STRONG_CHAR = /[\p{L}]/u;

/** Writing direction of a text: the theme's, or (auto) from its first strong letter. */
export function textDirection(text: string, theme?: Pick<Theme, 'direction'>): 'rtl' | 'ltr' {
  if (theme?.direction && theme.direction !== 'auto') return theme.direction;
  const first = [...text].find((ch) => STRONG_CHAR.test(ch));
  return first && RTL_CHAR.test(first) ? 'rtl' : 'ltr';
}

/**
 * Fonts a project's texts and graphics can use. Each ships with the editor (an @fontsource package), so the
 * preview and the export draw the same letters; the server serves them all in /api/graphics/fonts.css.
 */
export const THEME_FONTS: { family: string; pkg: string; about: string }[] = [
  { family: 'IBM Plex Sans Arabic', pkg: 'ibm-plex-sans-arabic', about: 'واضح ومريح — الافتراضي' },
  { family: 'Cairo', pkg: 'cairo', about: 'عصري وعريض' },
  { family: 'Tajawal', pkg: 'tajawal', about: 'نظيف وخفيف' },
  { family: 'Almarai', pkg: 'almarai', about: 'بسيط ومقروء' },
  { family: 'Changa', pkg: 'changa', about: 'هندسي للعناوين' },
  { family: 'Reem Kufi', pkg: 'reem-kufi', about: 'كوفي' },
  { family: 'Lalezar', pkg: 'lalezar', about: 'عريض جداً — للعناوين بس' },
];

/** Where a preset sits when the caller gives no place: a lower third low on the start side, a label up top, a caption at the bottom. */
export function presetPlace(preset: TextStyle['preset'], dir: 'rtl' | 'ltr'): Pick<TextStyle, 'x' | 'y' | 'align'> {
  const side = dir === 'rtl' ? 0.92 : 0.08;
  if (preset === 'lower-third') return { x: side, y: 0.82, align: 'start' };
  if (preset === 'label') return { x: 0.5, y: 0.14, align: 'center' };
  if (preset === 'caption') return { x: 0.5, y: 0.86, align: 'center' };
  return { x: 0.5, y: 0.5, align: 'center' };
}

const fontStack =(font: string) => (font === 'IBM Plex Sans Arabic' ? FONT_STACK : `'${font}', ${FONT_STACK}`);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Inline style string for the text box, in px of a frame `height` tall. */
export function textBoxStyle(clip: Pick<Clip, 'textStyle' | 'text'>, height: number, theme: Theme = Theme.parse({})): string {
  const s = TextStyle.parse(clip.textStyle ?? {});
  const dir = textDirection(clip.text ?? '', theme);
  // "start" is the edge the text starts from: right in RTL, left in LTR
  const startIsLeft = dir === 'ltr';
  const anchor = s.align === 'center' ? '-50%' : (s.align === 'start') === startIsLeft ? '0%' : '-100%';
  const textAlign = s.align === 'center' ? 'center' : (s.align === 'start') === startIsLeft ? 'left' : 'right';
  const k = height / 1080;
  const px = (v: number) => `${Math.round(v * k * 100) / 100}px`;
  const base = [
    'position:absolute',
    // without this an anchor near the right edge shrinks the box to the space left of it
    'width:max-content',
    'box-sizing:border-box',
    `left:${s.x * 100}%`,
    `top:${s.y * 100}%`,
    `transform:translate(${anchor},-50%)`,
    `font-family:${fontStack(s.font ?? theme.font)}`,
    `font-size:${px(s.size)}`,
    `font-weight:${s.weight}`,
    `color:${s.color ?? theme.text}`,
    `direction:${dir}`,
    `text-align:${textAlign}`,
    'line-height:1.35',
    'white-space:pre-wrap',
    'unicode-bidi:plaintext',
  ];
  const preset: Record<TextStyle['preset'], string[]> = {
    title: ['max-width:80%', `text-shadow:0 ${px(4)} ${px(24)} rgba(0,0,0,.55)`],
    'lower-third': [`padding:${px(14)} ${px(28)}`, `border-radius:${px(10)}`, `background:${s.background ?? theme.panel}`, `border-${startIsLeft ? 'left' : 'right'}:${px(8)} solid ${theme.accent}`, 'max-width:70%'],
    caption: [`padding:${px(8)} ${px(22)}`, `border-radius:${px(12)}`, `background:${s.background ?? 'rgba(0,0,0,.62)'}`, 'max-width:84%'],
    label: [`padding:${px(6)} ${px(18)}`, `border-radius:${px(999)}`, `background:${s.background ?? theme.accent}`, 'max-width:50%'],
    card: [`padding:${px(32)} ${px(44)}`, `border-radius:${px(22)}`, `background:${s.background ?? theme.panel}`, `box-shadow:0 ${px(18)} ${px(60)} rgba(0,0,0,.45)`, 'max-width:60%'],
  };
  if (s.background && s.preset === 'title') preset.title.push(`background:${s.background}`, `padding:${px(10)} ${px(24)}`, `border-radius:${px(12)}`);
  return [...base, ...preset[s.preset]].join(';');
}

/** `active`: index of the spoken word (its text's nth word) for a caption with a highlight colour. */
export function textLayerHtml(clip: Pick<Clip, 'text' | 'textStyle'>, height: number, theme?: Theme, active?: number): string {
  const highlight = clip.textStyle?.highlight;
  let body = esc(clip.text ?? '');
  if (highlight && active !== undefined && active >= 0) {
    // whitespace stays as it was (line breaks too); the whole word sits in the span, so Arabic letters still join
    let k = -1;
    body = (clip.text ?? '').split(/(\s+)/).map((part) => (/^\s*$/.test(part) ? part : ++k === active ? `<span style="color:${esc(highlight)}">${esc(part)}</span>` : esc(part))).join('');
  }
  return `<div style="${textBoxStyle(clip, height, theme)}">${body}</div>`;
}
