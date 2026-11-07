import { z } from 'zod';

// All times are in seconds. Source times (in/out) are positions inside the media file;
// timeline times (start) are positions in the edited output.

export const Grade = z.object({
  lut: z.string().optional(), // path relative to the project, e.g. "luts/ref-1.cube"
  lutMix: z.number().min(0).max(1).default(1),
  exposure: z.number().min(-1).max(1).default(0), // eq brightness
  contrast: z.number().min(0).max(2).default(1),
  saturation: z.number().min(0).max(3).default(1),
  gamma: z.number().min(0.1).max(3).default(1),
  temperature: z.number().min(1000).max(40000).default(6500), // colortemperature Kelvin, 6500 = neutral
});
export type Grade = z.infer<typeof Grade>;

/** How a value moves from a key to the next: smooth (ease in and out), linear, in (speeds up), out (slows down), hold (jumps at the next key). */
export const Ease = z.enum(['smooth', 'linear', 'in', 'out', 'hold']);
export type Ease = z.infer<typeof Ease>;

// ease: how the zoom/focus moves from this key to the next
export const Keyframe = z.object({ t: z.number(), scale: z.number(), x: z.number(), y: z.number(), ease: Ease.optional() });
export type Keyframe = z.infer<typeof Keyframe>;

export const Transform = z.object({
  // scale >= 1 zooms in; x/y is the focus point in 0..1 of the frame
  scale: z.number().min(1).max(20).default(1),
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  keyframes: z.array(Keyframe).default([]), // t is relative to the clip start
});
export type Transform = z.infer<typeof Transform>;

/** How a main-track clip comes in from the one before it. Centred on the cut: it doesn't change the edit's length. */
export const TransitionKind = z.enum(['crossfade', 'dip', 'flash', 'slide', 'zoom', 'blur', 'wipe']);
export const Transition = z.object({
  kind: TransitionKind,
  duration: z.number().min(0.1).max(3).default(0.5), // seconds, half on each side of the cut
});
export type Transition = z.infer<typeof Transition>;

/** Where a picture sits (a layer, or the main track's): scaled about the frame centre, then shifted — off the frame too. */
export const PLACE_LIMITS = { d: 3, scaleMin: 0.02, scaleMax: 10 } as const;
export const Place = z.object({
  dx: z.number().min(-PLACE_LIMITS.d).max(PLACE_LIMITS.d).default(0), // fraction of the frame width
  dy: z.number().min(-PLACE_LIMITS.d).max(PLACE_LIMITS.d).default(0), // fraction of the frame height
  scale: z.number().min(PLACE_LIMITS.scaleMin).max(PLACE_LIMITS.scaleMax).default(1),
  // the anchor: the point the size grows / shrinks about, as a fraction of the picture's full-frame box (0.5 = centre)
  ax: z.number().min(0).max(1).optional(), // default 0.5
  ay: z.number().min(0).max(1).optional(),
});
export type Place = z.infer<typeof Place>;

/**
 * How a video/still picture shows, beyond zoom/focus (Transform) and position/size (Place):
 * the source is cropped, flipped, fitted to the frame, then rotated about its centre.
 */
export const Picture = z.object({
  off: z.boolean().optional(), // keep the clip's timing and sound, without its picture
  fit: z.enum(['fill', 'fit']).default('fill'), // fill = cover the frame (edges cut); fit = the whole picture, bars around it
  bars: z.enum(['black', 'blur']).default('black'), // main track, fit: what fills around the picture (blur = a blurred, enlarged copy of it)
  rotate: z.number().min(-180).max(180).default(0), // degrees, clockwise
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
  crop: z.object({ // fraction of the source cut away on each side
    l: z.number().min(0).max(0.45).default(0),
    t: z.number().min(0).max(0.45).default(0),
    r: z.number().min(0).max(0.45).default(0),
    b: z.number().min(0).max(0.45).default(0),
  }).default({}),
  opacity: z.number().min(0).max(1).default(1), // over what is below (on the main track: over black)
});
export type Picture = z.infer<typeof Picture>;

/** Values that change over a clip: keys at moments of the clip (seconds from its start), eased between (by the earlier key's ease), per property. */
const keys = (min: number, max: number) => z.array(z.object({ t: z.number(), v: z.number().min(min).max(max), ease: Ease.optional() }));
export const Anim = z.object({
  dx: keys(-PLACE_LIMITS.d, PLACE_LIMITS.d).optional(), // a picture's place (Place.dx/dy/scale)
  dy: keys(-PLACE_LIMITS.d, PLACE_LIMITS.d).optional(),
  scale: keys(PLACE_LIMITS.scaleMin, PLACE_LIMITS.scaleMax).optional(),
  opacity: keys(0, 1).optional(), // Picture.opacity
  volume: keys(0, 4).optional(), // Clip.volume
});
export type Anim = z.infer<typeof Anim>;
export type AnimProp = keyof Anim;

/**
 * A graphic played scene by scene at other speeds: the page's scene edges `from` (page seconds, as
 * authored) fall at clip seconds `to`; between edges time is stretched linearly.
 */
// hold: a scene played longer keeps its motion at normal speed and holds its last frame (instead of slowing down)
export const Retime = z.object({ from: z.array(z.number().min(0)).min(2), to: z.array(z.number().min(0)).min(2), hold: z.boolean().optional() })
  .refine((r) => r.from.length === r.to.length, 'retime: from and to need the same number of edges')
  .refine((r) => [r.from, r.to].every((a) => a.every((v, i) => i === 0 || v > a[i - 1])), 'retime: edges must increase');
export type Retime = z.infer<typeof Retime>;

/** A hand edit of one element inside a graphic page (found by a CSS selector), applied over the page on every frame. */
export const GraphicEdit = z.object({
  target: z.string().min(1),
  label: z.string().optional(), // what the user saw when picking it
  text: z.string().optional(),
  color: z.string().optional(), // text colour (fill for SVG shapes)
  background: z.string().optional(),
  hidden: z.boolean().optional(),
  dx: z.number().optional(), // page pixels (the 1080p authoring frame)
  dy: z.number().optional(),
  scale: z.number().min(0.02).max(10).optional(),
});
export type GraphicEdit = z.infer<typeof GraphicEdit>;
export type Key = { t: number; v: number; ease?: Ease };

export const TextStyle = z.object({
  preset: z.enum(['title', 'lower-third', 'caption', 'label', 'card']).default('title'),
  font: z.string().optional(), // default: the project theme's font
  size: z.number().default(72), // px at 1080p height
  weight: z.number().default(700),
  color: z.string().optional(), // default: the project theme's text colour
  background: z.string().optional(),
  x: z.number().min(-0.5).max(1.5).default(0.5), // the frame is 0..1; a text may start or sit partly outside it
  y: z.number().min(-0.5).max(1.5).default(0.5),
  align: z.enum(['start', 'center', 'end']).default('center'),
  animation: z.enum(['none', 'fade', 'pop', 'slide-up', 'typewriter']).default('fade'),
});
export type TextStyle = z.infer<typeof TextStyle>;

export const Media = z.object({
  id: z.string(),
  path: z.string(), // relative to the project folder
  role: z.enum(['source', 'ref', 'broll', 'music', 'graphic', 'sfx']),
  kind: z.enum(['video', 'audio', 'image']),
  name: z.string(),
  duration: z.number().default(0),
  width: z.number().default(0),
  height: z.number().default(0),
  fps: z.number().default(0),
  hasAudio: z.boolean().default(false),
  // several audio tracks (a recording's mic / desktop / music): the file's first track mixes `mix` (original track
  // numbers, 0-based) and the `count` originals follow it — so everything reading the first track hears them all
  audioTracks: z.object({ count: z.number().int().min(2), mix: z.array(z.number().int().min(0)) }).optional(),
  proxy: z.string().optional(),
  peaks: z.string().optional(),
  thumbs: z.string().optional(), // json manifest of filmstrip sprites
  analyzed: z.array(z.string()).default([]), // finished analysis steps
  // made by the editor from another media: a part of it played backwards (its 0 = that part's end), or one still frame of it
  derived: z.object({ kind: z.enum(['reverse', 'freeze']), mediaId: z.string(), in: z.number(), out: z.number() }).optional(),
});
export type Media = z.infer<typeof Media>;

export const TrackKind = z.enum(['video', 'overlay', 'text', 'audio']);
export const Track = z.object({
  id: z.string(),
  kind: TrackKind,
  name: z.string(),
  magnetic: z.boolean().default(false), // main story track: clips are packed in order, no gaps
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  audio: z.enum(['music', 'voice']).default('music'),
  locked: z.boolean().default(false), // its clips take no edits until unlocked
});
export type Track = z.infer<typeof Track>;

export const Clip = z.object({
  id: z.string(),
  trackId: z.string(),
  mediaId: z.string().optional(), // absent for text clips
  // a blank on the main track (black, silent) — main-track magnet off: the track stays packed, a gap fills the space
  gap: z.literal(true).optional(),
  start: z.number().min(0), // timeline position
  in: z.number().min(0), // source in (for text clips: 0)
  out: z.number().min(0), // source out (for text clips: duration)
  speed: z.number().min(0.25).max(16).default(1),
  volume: z.number().min(0).max(4).default(1),
  fadeIn: z.number().min(0).max(10).optional(), // seconds the sound rises from silence at the clip's start
  fadeOut: z.number().min(0).max(10).optional(), // …and falls to silence before its end
  denoise: z.number().min(0).max(1).optional(), // voice cleanup strength: hum/rumble cut and background noise reduced (0/absent = off)
  label: z.string().optional(),
  grade: Grade.optional(),
  transform: Transform.optional(),
  text: z.string().optional(),
  textStyle: TextStyle.optional(),
  words: z.object({ mediaId: z.string(), from: z.number().int().min(0), to: z.number().int().min(0), clipId: z.string().optional() }).refine((w) => w.to >= w.from, 'word range is reversed').optional(),
  graphic: z.string().optional(), // HTML graphic: 'graphics/<name>' in the project, or 'lib/<template>' from graphics-lib/
  graphicData: z.record(z.unknown()).optional(), // handed to the page as GRAPHIC.data (template parameters)
  graphicEdits: z.array(GraphicEdit).optional(), // hand edits of elements inside the page
  retime: Retime.optional(), // graphic scenes played longer/shorter (in/out are in the retimed clock)
  place: Place.optional(), // position/size of a layer above the main track (graphic, b-roll picture-in-picture)
  picture: Picture.optional(), // fit, rotation, flip, crop, opacity of a video/still
  anim: Anim.optional(), // keyframes of place, opacity and volume (zoom/focus keyframes live in transform)
  transition: Transition.optional(), // main track: how this clip comes in from the previous one
});
export type Clip = z.infer<typeof Clip>;

export const Suggestion = z.object({
  id: z.string(),
  mediaId: z.string(),
  t0: z.number(),
  t1: z.number(),
  reason: z.enum(['silence', 'retake', 'filler', 'mistake', 'other']),
  note: z.string().optional(),
  author: z.enum(['analysis', 'claude', 'user']).default('analysis'),
});
export type Suggestion = z.infer<typeof Suggestion>;

/**
 * A visual the AI proposes over what is said, waiting for the user to add or dismiss it. It is pinned to the
 * words it goes with (source seconds of the spoken media), so it lands where they play after any cut.
 * graphic = a template filled in · text = words on screen · broll = a part of a b-roll media already in the
 * project · shot = footage the project doesn't have yet (what to film or look for; adding it leaves a comment).
 */
export const IdeaKind = z.enum(['graphic', 'text', 'broll', 'shot']);
export const Idea = z.object({
  id: z.string(),
  mediaId: z.string(),
  t0: z.number(),
  t1: z.number(),
  kind: IdeaKind,
  note: z.string(), // why it helps here, in the video's language — shown on the card
  duration: z.number().positive().max(60).optional(), // seconds on screen (default: as long as the words)
  graphic: z.string().optional(), // graphic: 'lib/<template>' or 'graphics/<name>'
  graphicData: z.record(z.unknown()).optional(),
  text: z.string().optional(), // text
  textStyle: TextStyle.partial().optional(),
  source: z.object({ mediaId: z.string(), in: z.number().min(0), out: z.number().min(0) }).optional(), // broll
  search: z.string().optional(), // shot: words to film by or to search stock sites with
  author: z.enum(['claude', 'user']).default('claude'),
});
export type Idea = z.infer<typeof Idea>;

/** The project's look for text presets and graphic templates. */
export const Theme = z.object({
  accent: z.string().default('#f2b33d'),
  accent2: z.string().default('#5ec2ff'),
  panel: z.string().default('rgba(14,16,24,.88)'), // card / lower-third background
  text: z.string().default('#ffffff'),
  font: z.string().default('IBM Plex Sans Arabic'),
  direction: z.enum(['auto', 'rtl', 'ltr']).default('auto'), // auto = from the text itself
});
export type Theme = z.infer<typeof Theme>;

export const BrandKit = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  theme: Theme.partial(),
  palette: z.array(z.object({ name: z.string(), color: z.string() })).default([]),
  logos: z.array(z.string()).default([]),
  fonts: z.array(z.object({ family: z.string(), file: z.string() })).default([]),
  notes: z.string().max(6000).default(''),
  source: z.string(),
  addedAt: z.string().datetime(),
});
export type BrandKit = z.infer<typeof BrandKit>;


/** A comment pinned to a moment (or a range) of the timeline: the user asks, Claude acts and replies. */
export const Note = z.object({
  id: z.string(),
  at: z.number().min(0), // timeline seconds; follows its content when the main track is edited
  end: z.number().optional(), // set for a comment about a range
  text: z.string(),
  author: z.enum(['user', 'claude']).default('user'),
  status: z.enum(['open', 'done']).default('open'),
  reply: z.string().optional(), // what was changed, or why not
});
export type Note = z.infer<typeof Note>;

export const Aspect = z.enum(['16:9', '9:16', '1:1', '4:5']);
export const Settings = z.object({
  marks: z.object({ in: z.number().finite().min(0).optional(), out: z.number().finite().min(0).optional() }).default({}),
  aspect: Aspect.default('16:9'),
  resolution: z.number().default(1080), // short edge: 1080 -> 1920x1080 or 1080x1920
  fps: z.number().default(30),
  loudness: z.number().default(-14),
  cutFade: z.number().default(0.012), // audio fade at every cut, seconds
  defaultGrade: Grade.optional(), // applied to video clips that have no grade of their own
  theme: Theme.default({}),
  brand: z.string().uuid().optional(),
  captionStyle: TextStyle.partial().optional(), // how generated captions look (set by a style)
  motionBlur: z.number().int().min(0).max(16).default(4), // shots averaged per graphic frame in final renders (0/1 = off)
  cover: z.number().min(0).optional(), // timeline second the project's cover on the home page shows (default: a third in)
  aiNotes: z.boolean().default(false), // a new comment starts an AI task on it right away (quick/standard tiers only)
});
export type Settings = z.infer<typeof Settings>;

export const StyleUse = z.object({
  id: z.string().min(1), name: z.string().min(1), source: z.enum(['preset', 'saved', 'library']),
  at: z.string().datetime(), by: z.enum(['user', 'claude']), what: z.string().min(1).max(500),
});
export type StyleUse = z.infer<typeof StyleUse>;

export const Project = z.object({
  version: z.literal(1).default(1),
  name: z.string(),
  createdAt: z.string(),
  settings: Settings.default({}),
  media: z.array(Media).default([]),
  tracks: z.array(Track).default([]),
  clips: z.array(Clip).default([]),
  suggestions: z.array(Suggestion).default([]),
  ideas: z.array(Idea).default([]), // visuals proposed over the speech, not yet added
  notes: z.array(Note).default([]),
  stylesUsed: z.array(StyleUse).default([]),
  style: z.string().optional(), // refs/<name>/style.json of the active style profile
});
export type Project = z.infer<typeof Project>;

// Analysis outputs (written by analysis/*.py, read-only for the editor)
export interface Word { i: number; t0: number; t1: number; w: string; p?: number }
export interface Transcript { mediaId: string; language: string; model: string; words: Word[]; segments: { t0: number; t1: number; w0: number; w1: number }[] }
export interface Shot { i: number; t0: number; t1: number; thumb?: string; kind: 'scene' | 'section' }

export const MAIN_TRACK = 'V1';

export const ProjectStart = z.enum(['video', 'podcast', 'empty']);
export type ProjectStart = z.infer<typeof ProjectStart>;

export function defaultTracks(start: ProjectStart = 'video'): Track[] {
  const tracks = [
    { id: 'V1', kind: 'video', name: 'الأساسي', magnetic: true, muted: false, hidden: false },
    { id: 'V2', kind: 'overlay', name: 'لقطات فوقية', magnetic: false, muted: false, hidden: false },
    { id: 'T1', kind: 'text', name: 'نصوص', magnetic: false, muted: false, hidden: false },
    { id: 'A2', kind: 'audio', name: 'موسيقى', magnetic: false, muted: false, hidden: false },
  ];
  if (start === 'empty') return tracks.slice(0, 1).map((t) => Track.parse(t));
  if (start === 'podcast') tracks.splice(2, 0, { id: 'V3', kind: 'overlay', name: 'صور إضافية', magnetic: false, muted: false, hidden: false });
  return tracks.map((t) => Track.parse(t));
}

export function outputSize(s: Pick<Settings, 'aspect' | 'resolution'>): { width: number; height: number } {
  const [a, b] = s.aspect.split(':').map(Number);
  const even = (n: number) => Math.round(n / 2) * 2; // yuv420p needs even dimensions
  return a >= b
    ? { width: even((s.resolution * a) / b), height: s.resolution }
    : { width: s.resolution, height: even((s.resolution * b) / a) };
}
