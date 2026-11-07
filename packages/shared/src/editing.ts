import { captionOps } from './captions.ts';
import { clipDuration, mainClips, mainDuration } from './timeline.ts';
import type { Op } from './ops.ts';
import type { Project, Transcript } from './schema.ts';

export const EDITING_RECIPES = [
  { id: 'explain', name: 'شرح عملي', description: 'حركة تقريب خفيفة، كابشن مقروء، وعنوان افتتاحي اختياري.', maxWords: 6, scale: 1.08, cadence: 10, animation: 'slide-up' as const },
  { id: 'punchy', name: 'إيقاع بصري سريع', description: 'تبديل التقريب كل 4 ثوانٍ وكابشن قصير متحرك. لا يحذف الكلام أو يسرّعه.', maxWords: 3, scale: 1.16, cadence: 4, animation: 'pop' as const },
  { id: 'documentary', name: 'سرد وثائقي', description: 'تقريب تدريجي هادئ وكابشن أطول، مع توزيع B-roll اختياري.', maxWords: 8, scale: 1.05, cadence: 16, animation: 'fade' as const },
] as const;
export interface EditingOptions { motion?: boolean; captions?: boolean; broll?: boolean; title?: string }
const TRACK = 'EDIT_STYLE';

/** Local edit recipes, not claims to reproduce an upstream film or semantic edit. */
export function editingPlan(p: Project, id: string, options: EditingOptions, transcript: (id: string) => Transcript | undefined) {
  const recipe = EDITING_RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error('Unknown editing recipe');
  const clips = mainClips(p), duration = mainDuration(p);
  if (!clips.length) throw new Error('أضف مقطعًا إلى التايملاين أولًا');
  const ops: Op[] = [], warnings: string[] = [], summary: string[] = [];
  if (options.motion) {
    const eligible = clips.filter((c) => c.mediaId && !c.transform && p.media.find((m) => m.id === c.mediaId)?.kind === 'video');
    for (const c of eligible) {
      const d = clipDuration(c), keyframes = [{ t: 0, scale: 1, x: 0.5, y: 0.5 }];
      if (recipe.id === 'punchy') {
        for (let t = recipe.cadence; t < d - 0.15; t += recipe.cadence) {
          const before = keyframes[keyframes.length - 1].scale;
          keyframes.push({ t: t - 0.1, scale: before, x: 0.5, y: 0.5 }, { t, scale: before === 1 ? recipe.scale : 1, x: 0.5, y: 0.5 });
        }
      } else keyframes.push({ t: d, scale: recipe.scale, x: 0.5, y: 0.5 });
      ops.push({ op: 'update_clip', clipId: c.id, patch: { transform: { keyframes } } });
    }
    summary.push(`حركة كاميرا على ${eligible.length} لقطة`);
    if (clips.some((c) => c.transform)) warnings.push('اللقطات التي فيها تأطير أو حركة سابقة محفوظة دون تغيير.');
  }
  if (options.captions) {
    const audible = clips.filter((c) => c.mediaId && p.media.find((m) => m.id === c.mediaId)?.hasAudio);
    if (audible.length && audible.every((c) => transcript(c.mediaId!)?.words.length)) {
      const captions = captionOps(p, transcript, { maxWords: recipe.maxWords, style: { animation: recipe.animation } });
      if (captions.length > 2) { ops.push(...captions); summary.push(`إعادة بناء ${captions.length - 2} كابشن من النص`); }
    } else warnings.push('الكابشن لم يتغير: أكمل التفريغ الصوتي لكل المقاطع الناطقة أولًا.');
  }
  const title = options.title?.trim();
  if (title || options.broll) {
    const overlays: Op[] = [];
    if (title) overlays.push({ op: 'add_clip', clip: { trackId: TRACK, graphic: 'lib/chapter', graphicData: { title, subtitle: '', number: '' }, in: 0, out: Math.min(3, duration), start: 0, label: 'عنوان ستايل المونتاج' } });
    if (options.broll) {
      const media = p.media.filter((m) => m.role === 'broll' && m.kind === 'video' && m.duration > 0);
      let at = Math.max(5, recipe.cadence);
      for (const m of media) {
        if (at >= duration) break;
        const length = Math.min(4, m.duration, duration - at);
        overlays.push({ op: 'add_clip', clip: { trackId: TRACK, mediaId: m.id, in: 0, out: length, start: at, volume: 0, label: `B-roll · ${m.name}` } });
        at += recipe.cadence * 2;
      }
      if (!media.length) warnings.push('لا توجد ملفات B-roll مستوردة؛ لم تُولَّد لقطات جديدة.');
      else warnings.push('توزيع B-roll زمني حسب ترتيب الملفات؛ راجع ملاءمته لمعنى الكلام.');
    }
    if (overlays.length) {
      ops.push({ op: 'add_track', track: { id: TRACK, kind: 'overlay', name: 'ستايل المونتاج' } }, { op: 'clear_track', trackId: TRACK }, ...overlays);
      summary.push(`${overlays.length} عنصر على مسار ستايل المونتاج (يستبدل نسخته السابقة)`);
    }
  }
  return { ops, summary, warnings };
}
