// Read public metadata/prompts only. Never execute downloaded code or install skills.
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../style-library/', import.meta.url));
const definitions = [
  ['hyperframes', 'heygen-com/hyperframes', 'HyperFrames'],
  ['lemo', 'lemomo-ai/lemo-opuscar', 'Lemo Opuscar'],
  ['awesome', 'yihui-dev/awesome-opus5-5-videos', 'Awesome Opus Videos'],
  ['animation', 'JohnHeibel/ClaudeAnimationBase', 'Claude Animation Base'],
  ['collage', 'pyang5166/gbro-collage-broll', 'Collage B-roll'],
  ['onetake', 'feitangyuan/onetake', 'OneTake'],
];
async function get(url, json = true) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Qassa-style-catalog' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return json ? r.json() : r.text();
}
/** a linked clip that is really there (some examples have only a poster) */
async function exists(url) {
  const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Qassa-style-catalog' }, signal: AbortSignal.timeout(30000) }).catch(() => undefined);
  return !!r?.ok;
}
async function pooled(items, fn) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}
await mkdir(`${root}/licenses`, { recursive: true });
const sources = [], entries = [];
for (const [id, repo, name] of definitions) {
  const tree = await get(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`);
  if (tree.truncated) throw new Error(`Truncated tree: ${repo}`);
  const revision = tree.sha;
  const raw = (path) => `https://raw.githubusercontent.com/${repo}/${revision}/${path}`;
  const sourceUrl = `https://github.com/${repo}`;
  const link = (path) => `${sourceUrl}/blob/${revision}/${path}`;
  const licenseText = await get(raw('LICENSE'), false);
  const license = licenseText.includes('PolyForm Noncommercial') ? 'PolyForm Noncommercial 1.0.0' : licenseText.includes('MIT License') ? 'MIT' : licenseText.includes('Apache License') ? 'Apache-2.0' : 'See source license';
  await writeFile(`${root}/licenses/${id}.txt`, licenseText);
  sources.push({ id, name, url: sourceUrl, revision, license, licenseUrl: link('LICENSE') });
  // preview images / clips are linked, not downloaded: the editor loads them on view
  const files = new Set(tree.tree.map((f) => f.path));
  if (id === 'lemo') {
    // every style's film, web-sized, is an asset of the "web" release
    const films = new Set((await get(`https://api.github.com/repos/${repo}/releases/tags/web`)).assets.map((a) => a.name));
    const paths = tree.tree.map((f) => f.path).filter((p) => /^styles\/[^_][^/]*\/style.json$/.test(p));
    entries.push(...await pooled(paths, async (path) => {
      const data = await get(raw(path));
      const promptPath = path.replace('style.json', 'STYLE.md');
      const frame = `docs/frames/${data.slug}.jpg`;
      return { id: `lemo:${data.slug}`, source: id, title: data.en, category: data.category_en, description: data.line, tags: data.uses ?? [], duration: data.dur, url: link(promptPath), ...(files.has(frame) ? { thumb: raw(frame) } : {}), ...(films.has(`${data.slug}.mp4`) ? { video: `${sourceUrl}/releases/download/web/${data.slug}.mp4`, ...(data.frame_sec ? { videoStart: data.frame_sec } : {}) } : {}), prompt: await get(raw(promptPath), false), mode: 'brief', requirements: 'يتطلب إخراج مشاهد مخصصة بواسطة المساعد؛ ليس فلترًا جاهزًا.' };
    }));
  } else if (id === 'hyperframes') {
    const paths = tree.tree.map((f) => f.path).filter((p) => /^registry\/(blocks|components)\/[^/]+\/registry-item.json$/.test(p));
    entries.push(...await pooled(paths, async (path) => {
      const data = await get(raw(path));
      return { id: `hyperframes:${data.name}`, source: id, title: data.title ?? data.name, category: data.type, description: data.description ?? '', tags: data.tags ?? [], duration: data.duration, url: link(path), ...(data.preview?.poster ? { thumb: data.preview.poster } : {}), ...(data.preview?.video ? { video: data.preview.video } : {}), mode: 'brief', requirements: 'قالب HyperFrames يحتاج تركيبًا وتكييفًا واختبار حركة قبل إدخاله للمشروع.', prompt: JSON.stringify({ name: data.name, type: data.type, description: data.description, dimensions: data.dimensions, duration: data.duration, params: data.params, files: data.files }, null, 2) };
    }));
  } else if (id === 'awesome') {
    const videos = await get(raw('data/videos.json'));
    const clips = await pooled(videos, (v) => exists(`https://media.skillry.dev/opus-5-5/${v.slug}/original.mp4`));
    entries.push(...videos.map((v, i) => ({ id: `awesome:${v.slug}`, source: id, title: `${v.author} · ${v.slug}`, category: v.category, description: (v.prompt ?? '').slice(0, 220), tags: v.tech_tags ?? [], url: v.post_url, demoUrl: v.skillry_url, ...(v.poster_url ? { thumb: v.poster_url } : {}), ...(clips[i] ? { video: `https://media.skillry.dev/opus-5-5/${v.slug}/original.mp4` } : {}), prompt: v.prompt ?? '', mode: 'brief', requirements: 'مرجع وبرومبت من صاحبه؛ راجع حقوق الأصول الأصلية قبل إعادة استخدامها.' })));
  } else {
    const description = id === 'animation' ? 'رسوم شخصيات مرسومة باليد باستخدام p5.js وp5.brush؛ تتطلب تكييف التوقيت مع المحرر.' : id === 'collage' ? 'تجميع كولاج ورقي من البداية إلى النهاية لمقطع B-roll قصير؛ يتطلب توليد صور ومفتاح Gemini مدفوع للفيديو.' : 'حركة متصلة تحمل العنصر من مشهد لآخر؛ ترخيص المصدر للاستخدام غير التجاري.';
    entries.push({ id: `${id}:workflow`, source: id, title: name, category: 'workflow', description, tags: [id], url: sourceUrl, mode: 'reference', requirements: description });
  }
  console.log(`${name}: ${entries.filter((e) => e.source === id).length} entries @ ${revision.slice(0, 12)}`);
}
const payload = { syncedAt: new Date().toISOString(), sources, entries };
await writeFile(`${root}/catalog.json.tmp`, JSON.stringify(payload, null, 2));
await rename(`${root}/catalog.json.tmp`, `${root}/catalog.json`);
console.log(`Saved ${entries.length} entries. No upstream code was executed.`);
