// Requests typed to the AI from inside the editor go to the smallest model that can do them well:
// a quick change (a word, a colour, a length) does not need the model that edits a whole video.
// Rules decide most requests; the server asks a small model to classify the rest.

export type Tier = 'quick' | 'standard' | 'deep';

export interface TierInfo {
  label: string;
  model: 'haiku' | 'sonnet' | 'opus';
  effort: 'low' | 'medium' | 'high';
  /** hard cap per task (claude --max-budget-usd) */
  budget: number;
  /** rough cost range in USD, shown before running — the real cost is shown after */
  estimate: [number, number];
  /** what this tier is for, in the editor's words */
  about: string;
}

export const TIERS: Record<Tier, TierInfo> = {
  quick: { label: 'سريع', model: 'haiku', effort: 'low', budget: 0.3, estimate: [0.01, 0.08], about: 'تعديل محدد: نص، لون، مدة، مكان، حذف' },
  standard: { label: 'متوسط', model: 'sonnet', effort: 'medium', budget: 2, estimate: [0.1, 0.8], about: 'عدة خطوات: كابشن، مؤثرات، رسوم من القوالب، قص السكتات، تنفيذ التعليقات' },
  deep: { label: 'عميق', model: 'opus', effort: 'high', budget: 8, estimate: [0.8, 4], about: 'شغل كامل: مونتاج من الصفر، شورت، رسمة جديدة، ستايل من رفرنس' },
};

const rule = (tier: Tier, why: string, ...words: string[]) => ({ tier, why, re: new RegExp(words.join('|'), 'i') });

// checked in order: the heaviest first, so «اعمل مونتاج كامل وغير لون النص» is deep, not quick
const RULES = [
  rule('deep', 'مونتاج كامل أو عمل كبير', 'مونتاج كامل', 'مَ?نتِ?ج', 'من الصفر', 'كامل الفيديو', 'الفيديو كامل', 'شورت', 'shorts?', 'ريلز', 'reels?', 'full edit', 'from scratch'),
  rule('deep', 'رسمة أو ستايل جديد', 'رسمة جديدة', 'انيميشن جديد', 'أنيميشن جديد', 'صمم', 'صمّم', 'ستايل من', 'رفرنس', 'reference', 'new (graphic|animation)', 'design'),
  rule('standard', 'عدة خطوات على المقطع', 'كابشن', 'ترجم', 'captions?', 'subtitles?', 'مؤثرات', 'sfx', 'السكتات', 'الصمت', 'الإعادات', 'silences?', 'retakes?', 'التعليقات', 'comments', 'notes', 'انتقالات', 'transitions', 'موسيقى', 'music', 'بي.?رول', 'b-?roll', 'لوّن', 'لون الفيديو', 'تلوين', 'grade', 'رتب', 'رتّب', 'اختصر', 'قصّر الفيديو', 'رسمة', 'رسوم', 'graphic', 'اختصار', 'خطوات', 'مقارنة', 'ستايل', 'style'),
  rule('quick', 'تعديل محدد وصغير', 'غيّ?ر', 'بدّ?ل', 'عدّ?ل', 'صحّ?ح', 'خلّ?ي', 'لون', 'colou?r', 'نص', 'text', 'كلمة', 'عنوان', 'title', 'حرك', 'حرّك', 'move', 'كبّ?ر', 'صغّ?ر', 'bigger', 'smaller', 'احذف', 'امسح', 'delete', 'remove', 'طوّ?ل', 'قصّ?ر', 'longer', 'shorter', 'مدة', 'duration', 'اخف', 'أخف', 'hide', 'اسم', 'rename', 'سرعة', 'speed', 'صوت', 'volume', 'mute'),
];

const QUICK_START = /^(لو سمحت\s+)?(غيّ?ر|بدّ?ل|عدّ?ل|صحّ?ح|احذف|امسح|شيل|حرّ?ك|كبّ?ر|صغّ?ر|طوّ?ل|قصّ?ر|اخف|أخف|خلّ?[يه]?|change|delete|remove|move|rename|hide|make (it|the))\s/i;

/** The tier the rules give a request, or undefined when none fits (then a small model classifies it). */
export function routeByRules(text: string): { tier: Tier; why: string } | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const deep = RULES.find((r) => r.tier === 'deep' && r.re.test(t));
  if (deep) return { tier: 'deep', why: deep.why };
  // a short request that starts by naming one change («احذف الرسمة», «غيّر العنوان») is quick whatever it touches
  const many = t.length > 220 || (t.match(/(^|\s)(و|ثم|بعدين|and|then)\s/g) ?? []).length >= 3;
  if (!many && t.length <= 80 && QUICK_START.test(t)) return { tier: 'quick', why: 'تعديل محدد وصغير' };
  const hit = RULES.find((r) => r.re.test(t));
  if (!hit) return undefined;
  // a "quick" word inside a long, many-part request is not a quick task
  if (hit.tier === 'quick' && many) return { tier: 'standard', why: 'طلب فيه عدة أجزاء' };
  return { tier: hit.tier, why: hit.why };
}

/** Prompt for the small model that classifies a request no rule fits; it answers one word. */
export function classifierPrompt(text: string): string {
  return `Classify this request to an AI video editor into one tier. Answer with ONE word: quick, standard or deep.
quick = one small specific change (a text, a colour, a clip's length or place, delete something).
standard = several steps with the editor's tools (captions, sound effects, graphics from templates, cutting silences, applying comments, colour).
deep = a whole edit, a short from a long video, a brand-new animation or design, a style matched from a reference.
Request: """${text.slice(0, 1500)}"""`;
}

/** The tier in a classifier's answer (standard when it is unclear). */
export function parseTier(answer: string): Tier {
  const m = answer.toLowerCase().match(/\b(quick|standard|deep)\b/);
  return (m?.[1] as Tier | undefined) ?? 'standard';
}

const RANK: Record<Tier, number> = { quick: 0, standard: 1, deep: 2 };

/** The tier for working through timeline comments: the heaviest comment decides, several comments are
 *  at least standard, and a comment no rule recognises gets standard (it still has to be found and read). */
export function routeNotes(texts: string[]): { tier: Tier; why: string } {
  if (!texts.length) return { tier: 'quick', why: 'ما فيه تعليقات' };
  const routes = texts.map((t) => routeByRules(t) ?? { tier: 'standard' as Tier, why: 'تعليق يحتاج قراءة المكان' });
  const top = routes.reduce((a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a));
  if (texts.length > 1 && top.tier === 'quick') return { tier: 'standard', why: `${texts.length} تعليقات` };
  return texts.length > 1 ? { tier: top.tier, why: `${texts.length} تعليقات — ${top.why}` } : top;
}
