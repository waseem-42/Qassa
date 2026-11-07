// The style library sorted by what an editor wants to make, not by where an entry came from. The three sources mix
// film looks (Lemo), buildable scenes (HyperFrames) and people's prompts (Awesome, titled "author · slug"); each
// entry gets one use from its source, category, tags and words, and a readable title.

export interface StyleUseGroup { id: string; label: string; hint: string; /** left out of the gallery unless asked for */ hidden?: boolean }

export const STYLE_USES: StyleUseGroup[] = [
  { id: 'looks', label: 'أساليب بصرية كاملة', hint: 'فيلم كامل بشكل واحد: سينمائي، وثائقي، رسم، طباعة، أنمي…' },
  { id: 'titles', label: 'عناوين ونصوص', hint: 'عناوين متحركة، لوثر ثيرد، كابشن وتايبوغرافي' },
  { id: 'explain', label: 'شرح ومخططات', hint: 'مخططات، خطوات، كود، تعليقات توضيحية' },
  { id: 'data', label: 'أرقام ورسوم بيانية', hint: 'عدّادات، نسب، رسوم بيانية' },
  { id: 'product', label: 'واجهات وعرض منتجات', hint: 'تطبيقات وجوالات ومواقع ومحادثات' },
  { id: 'intros', label: 'افتتاحيات وشعارات', hint: 'مقدمات، شعارات، نهايات وعدّ تنازلي' },
  { id: 'transitions', label: 'انتقالات', hint: 'من لقطة للثانية' },
  { id: 'social', label: 'سوشال وإعلانات', hint: 'شورتس، كاروسيل، معارض صور، إعلانات' },
  { id: 'maps', label: 'خرائط وأماكن', hint: 'خرائط ومسارات ومدن' },
  { id: '3d', label: 'ثلاثي الأبعاد', hint: 'مجسمات وكاميرا تدور' },
  { id: 'effects', label: 'خلفيات ومؤثرات', hint: 'خلفيات، خامات، توهج، جزيئات' },
  { id: 'motion', label: 'موشن جرافيك', hint: 'حركة عامة وأفكار متنوعة' },
  { id: 'lab', label: 'تجارب ويب تفاعلية', hint: 'ألعاب وتجارب تفاعلية — للإلهام، ما تصلح كمقطع مباشرة', hidden: true },
  { id: 'workflows', label: 'سير عمل', hint: 'طرق عمل كاملة تحتاج أدوات خارجية', hidden: true },
];

interface Classifiable { source: string; category: string; tags: string[]; title: string; description: string }

const has = (tags: string[], list: string[]) => tags.some((t) => list.includes(t));

/** One use per entry: first rule that fits. */
export function styleUseOf(e: Classifiable): string {
  if (e.source === 'lemo') return 'looks';
  if (e.category === 'workflow') return 'workflows';
  const t = e.tags.map((x) => x.toLowerCase());
  const text = `${e.title} ${e.description}`.toLowerCase();
  const says = (re: RegExp) => re.test(text);
  if (e.category === 'interactive' || has(t, ['playable', 'physics']) || says(/\b(playable|game ?play|mini[- ]?game|click to|drag to|mouse|keyboard controls?|interactive)\b/)) return 'lab';
  if (has(t, ['map']) || says(/\b(maps?|globe|routes?|geograph\w*)\b/)) return 'maps';
  if (has(t, ['data', 'chart']) || says(/\b(charts?|graphs?|pie chart|counters?|count[- ]?up|statistics?|stats|infographics?)\b/)) return 'data';
  if (has(t, ['transition', 'transition-primitive', 'transitions-dev-port', 'wipe', 'morph'])) return 'transitions';
  if (has(t, ['typography', 'title-card', 'lower-third', 'captions', 'caption-style', 'text', 'text-effects', 'handwritten']) || says(/\b(kinetic typography|typography|lower[- ]third|title card|captions?|lyric)/)) return 'titles';
  if (has(t, ['logo']) || says(/\b(logo|intro|outro|opener|countdown|ident)\b/)) return 'intros';
  if (has(t, ['mock-ui', 'ui-props', 'product-demo', 'chat', 'cursor', 'ai']) || says(/\b(saas|app (store|showcase|demo)|product (launch|demo|video)|ui|website|landing page|iphone|phone)\b/)) return 'product';
  if (has(t, ['annotation', 'code', 'code-animation', 'developer', 'diagram']) || e.category === 'explainer' || says(/\b(explainer|explain|diagram|flowchart|how it works|step[- ]by[- ]step|tutorial)/)) return 'explain';
  if (has(t, ['social', 'vertical', 'ad-template', 'carousel', 'gallery', 'images', 'podcast', 'interview', 'creator'])) return 'social';
  if (e.category === '3d' || has(t, ['3d', 'threejs', '3d-motion', 'orbit'])) return '3d';
  if (has(t, ['background', 'texture', 'shader', 'webgpu', 'webgpu-shader', 'webgl', 'gradient', 'particles', 'glow', 'overlay', 'effect', 'effects', 'media-treatment-overlay', 'motion-blur'])) return 'effects';
  return 'motion';
}

// whole words only, each followed by a space ("Adopt" must not lose its "A")
const LEAD = /^(?:(?:hey|hi|hello|ok(?:ay)?|so|please|alright|now)[,!.:]?\s+)*(?:(?:(?:can|could|would) you(?: please)?|i(?:'d| would)? (?:want|like|need)(?: you)? to|i want|let'?s|we(?:'re| are) going to|go(?: and)?|please)\s+)?(?:(?:make|create|build|generate|design|render|produce|write|animate)(?: me| us)?\s+)?(?:(?:a|an|the)\s+)?/i;

/**
 * A readable title. Awesome entries are "author · slug" with the prompt as their description: the first sentence
 * about the video, without the request around it ("I want you to create a…"), cut at a word.
 */
export function styleTitleOf(e: Pick<Classifiable, 'source' | 'title' | 'description'>): { title: string; author?: string } {
  if (e.source !== 'awesome' || !e.description) return { title: e.title };
  const author = e.title.split(' · ')[0];
  const plain = e.description.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).filter((s) => s.replace(/[^a-z]/gi, '').length > 8);
  const about = sentences.find((s) => /\b(video|animation|motion|explainer|graphic|trailer|intro|scene|visuali[sz]|reel|film|short|ad)\b/i.test(s)) ?? sentences[0] ?? plain;
  let title = about.replace(LEAD, '').replace(/[.!?]+$/, '').trim();
  if (title.length > 72) title = `${title.slice(0, 70).replace(/\s+\S*$/, '')}…`;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title: title || e.title, author };
}
