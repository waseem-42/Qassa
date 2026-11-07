import { describe, expect, it } from 'vitest';
import { applyOps, defaultTracks, Picture, mainClips as mainClipsOf, Project } from '@edit/shared';
import { compile, framingFilters, gradeFilters } from '../src/index.ts';

const base = () =>
  Project.parse({
    name: 'demo',
    createdAt: '2026-01-01',
    tracks: defaultTracks(),
    media: [
      { id: 'm1', path: 'source/a.mp4', proxy: 'analysis/m1/proxy.mp4', role: 'source', kind: 'video', name: 'a', duration: 60, width: 2560, height: 1440, fps: 60, hasAudio: true },
      { id: 'mu', path: 'source/music.mp3', role: 'music', kind: 'audio', name: 'music', duration: 120, hasAudio: true },
    ],
    clips: [{ id: 'c0', trackId: 'V1', mediaId: 'm1', start: 0, in: 0, out: 60 }],
  });

const opts = { quality: 'final' as const, nvenc: true, fileKey: () => 'k' };

describe('compile', () => {
  it('restores lossless alpha from dual-stream graphic caches at the project frame rate', () => {
    const p = applyOps(base(), [{ op: 'add_clip', clip: { trackId: 'V2', graphic: 'lib/chapter', in: 0, out: 4, start: 2 } }]);
    const graph = compile(p, { ...opts, graphicVideo: () => 'cache/graphics/layer.rgba.mkv' }).final.args.join(' ');
    expect(graph).toContain(':v:0]fps=30'); expect(graph).toContain(':v:1]fps=30,format=gray'); expect(graph).toContain('alphamerge');
    const legacy = compile(p, { ...opts, graphicVideo: () => 'cache/graphics/legacy.mov' }).final.args.join(' ');
    expect(legacy).not.toContain('alphamerge');
  });
  it('voice audio is not auto-faded or ducked and becomes a key for the music', () => {
    let p = applyOps(base(), [{ op: 'add_track', track: { id: 'voice', kind: 'audio', name: 'كلام', audio: 'voice' } }, { op: 'add_clip', clip: { trackId: 'voice', mediaId: 'mu', in: 0, out: 10, start: 0, denoise: .5 } }]);
    let graph = compile(p, opts).final.args.join(' ');
    expect(graph).toContain('afftdn=nr=18');
    expect(graph).not.toContain('afade'); expect(graph).not.toContain('sidechaincompress');
    expect(graph).toContain('[mainvoice][va1]amix');
    p = applyOps(p, [{ op: 'add_clip', clip: { trackId: 'A2', mediaId: 'mu', in: 0, out: 10, start: 0, volume: .2 } }]);
    graph = compile(p, opts).final.args.join(' ');
    expect(graph).toContain('[speech]asplit=2[voice][key]');
    expect(graph).toContain('[bed][key]sidechaincompress');
  });
  it('picture off uses black on V1 and transitions, preserves mp4 sound, and removes only overlay pictures', () => {
    let p = applyOps(base(), [{ op: 'split', clipId: 'c0', at: 10 }, { op: 'update_clip', clipId: 'c0', patch: { picture: Picture.parse({ off: true }) } }]);
    const plain = compile(base(), opts);
    let plan = compile(p, opts);
    expect(plan.segments[0].hash).not.toBe(plain.segments[0].hash);
    expect(plan.segments[0].args.join(' ')).toContain('color=c=black');
    expect(plan.segments[0].args.join(' ')).toContain('[0:a]');
    p = applyOps(p, [{ op: 'set_transition', clipIds: [mainClipsOf(p)[1].id], kind: 'crossfade', duration: .5 }]);
    plan = compile(p, opts);
    expect(plan.segments[1].args.join(' ')).toContain('color=c=black');
    p = applyOps(p, [{ op: 'add_clip', clip: { trackId: 'V2', mediaId: 'm1', in: 1, out: 3, start: 2, picture: Picture.parse({ off: true }) } }]);
    const graph = compile(p, opts).final.args.join(' ');
    expect(graph).toContain('source/a.mp4');
    expect(graph).toContain('[1:a]');
    expect(graph).not.toContain('[ov1]');
  });
  it('one segment per main clip, video copied when nothing overlays it', () => {
    const p = applyOps(base(), [{ op: 'cut_range', mediaId: 'm1', t0: 10, t1: 20 }]);
    const plan = compile(p, opts);
    expect(plan.segments).toHaveLength(2);
    expect(plan.duration).toBeCloseTo(50);
    const a = plan.segments[1].args;
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 6)).toEqual(['-ss', '20', '-t', '40.0667', '-i', 'source/a.mp4']);
    // whole frames on the cumulative timeline: 10s + 40s at 30fps
    expect(plan.segments.map((x) => Math.round(x.duration * 30))).toEqual([300, 1200]);
    expect(a).toContain('-hwaccel');
    expect(plan.final.args).toContain('copy');
    expect(plan.concatList.body.split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('voice cleanup goes into the clip sound and changes the segment', () => {
    const plain = compile(base(), opts).segments[0];
    const p = applyOps(base(), [{ op: 'update_clip', clipId: 'c0', patch: { denoise: 0.5 } }]);
    const seg = compile(p, opts).segments[0];
    expect(seg.args.join(' ')).toContain('highpass=f=75,afftdn=nr=18:nf=-35:tn=1');
    expect(seg.hash).not.toBe(plain.hash);
  });

  it('preview uses the proxy and 720p', () => {
    const plan = compile(base(), { ...opts, quality: 'preview' });
    expect(plan.segments[0].args).toContain('analysis/m1/proxy.mp4');
    expect([plan.width, plan.height]).toEqual([1280, 720]);
  });

  it('segment cache key changes with the grade', () => {
    const a = compile(base(), opts).segments[0].hash;
    const p = applyOps(base(), [{ op: 'set_grade', clipIds: ['c0'], grade: { saturation: 1.3 } }]);
    expect(compile(p, opts).segments[0].hash).not.toBe(a);
  });

  it('b-roll sound follows the clip speed and is cut to it', () => {
    const p = applyOps(base(), [{ op: 'add_clip', clip: { trackId: 'V2', mediaId: 'm1', in: 10, out: 18, start: 5, speed: 2 } }]);
    const graph = compile(p, opts).final.args.join(' ');
    expect(graph).toMatch(/atempo=2,atrim=duration=4,afade=t=in/);
  });

  it('pop text grows about the frame centre, as in the preview', () => {
    const p = applyOps(base(), [{ op: 'add_text', text: 'مرحبا', start: 2, duration: 3, style: { animation: 'pop' } }]);
    const graph = compile(p, { ...opts, textImage: () => 'cache/text/x.png' }).final.args.join(' ');
    expect(graph).toContain("scale=w='trunc(iw*(0.92+0.08*min(1,t/0.35)))'");
    expect(graph).toContain('pad=w=1920:h=1080');
  });

  it('music is ducked and mixed', () => {
    const p = applyOps(base(), [{ op: 'add_clip', clip: { trackId: 'A2', mediaId: 'mu', in: 0, out: 30, start: 5 } }]);
    const graph = compile(p, opts).final.args.join(' ');
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain('adelay=5000');
  });

  it('graphic clips overlay their pre-rendered video at their timeline slot; hidden or unrendered ones are skipped', () => {
    const p = applyOps(base(), [{ op: 'add_clip', clip: { id: 'g1', trackId: 'V2', graphic: 'graphics/steps', start: 12, in: 0, out: 8 } }]);
    const args = compile(p, { ...opts, graphicVideo: (c) => (c.id === 'g1' ? 'cache/graphics/abc.mov' : undefined) }).final.args;
    expect(args.slice(args.indexOf('cache/graphics/abc.mov') - 3, args.indexOf('cache/graphics/abc.mov') + 1)).toEqual(['-t', '8', '-i', 'cache/graphics/abc.mov']);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('setpts=PTS-STARTPTS+12/TB');
    expect(graph).toContain("enable='between(t,12,20)'");
    expect(compile(p, opts).final.args).toContain('copy');
    const hidden = applyOps(p, [{ op: 'set_track', trackId: 'V2', patch: { hidden: true } }]);
    expect(compile(hidden, { ...opts, graphicVideo: () => 'cache/graphics/abc.mov' }).final.args).not.toContain('cache/graphics/abc.mov');
  });

  it('a moved / resized graphic is scaled about the centre and shifted in the overlay', () => {
    const p = applyOps(base(), [{ op: 'add_clip', clip: { id: 'g1', trackId: 'V2', graphic: 'lib/keys', start: 2, in: 0, out: 3, place: { dx: 0.25, dy: -0.1, scale: 0.5 } } }]);
    const graph = compile(p, { ...opts, graphicVideo: () => 'cache/graphics/k.mov' }).final.args.join(' ');
    expect(graph).toContain('scale=w=trunc(iw*0.5/2)*2:h=trunc(ih*0.5/2)*2');
    expect(graph).toContain("overlay=x='(main_w-overlay_w)/2+480':y='(main_h-overlay_h)/2+-108'");
  });

  it('a transition is its own segment centred on the cut; the edit keeps its length and the clips around it are shortened by half each', () => {
    let p = applyOps(base(), [{ op: 'cut_range', mediaId: 'm1', t0: 10, t1: 20 }]);
    const hard = compile(p, opts);
    p = applyOps(p, [{ op: 'set_transition', clipIds: [mainClipsOf(p)[1].id], kind: 'dip', duration: 1 }]);
    const plan = compile(p, opts);
    expect(plan.segments.map((s) => s.clipId)).toEqual([mainClipsOf(p)[0].id, `${mainClipsOf(p)[1].id}:in`, mainClipsOf(p)[1].id]);
    expect(plan.segments.map((s) => Math.round(s.duration * 30))).toEqual([285, 30, 1185]);
    expect(plan.duration).toBeCloseTo(hard.duration);
    const tr = plan.segments[1].args.join(' ');
    expect(tr).toContain('xfade=transition=fadeblack:duration=1:offset=0,format=yuv420p');
    // A runs on past its out-point (10s), B starts before its in-point (20s)
    expect(tr).toMatch(/-ss 9\.5 .*-ss 19\.5 /);
    expect(tr).toContain('concat=n=2:v=0:a=1');
    // no click-fade inside a clip where the sound runs on into the transition
    expect(plan.segments[0].args.join(' ')).not.toContain('afade=t=out');
    expect(plan.segments[2].args.join(' ')).not.toContain('afade=t=in');
    expect(plan.segments[2].args.slice(0, 6)).toContain('20.5');
    // clips without a transition render exactly as before (same cache entries)
    expect(compile(applyOps(p, [{ op: 'set_transition', clipIds: [mainClipsOf(p)[1].id], kind: null }]), opts).segments.map((s) => s.hash)).toEqual(hard.segments.map((s) => s.hash));
  });

  it('a sound-only main track (a podcast) plays over black, cuts and transitions included', () => {
    const p = Project.parse({ ...base(), clips: [{ id: 'a', trackId: 'V1', mediaId: 'mu', start: 0, in: 0, out: 10 }, { id: 'b', trackId: 'V1', mediaId: 'mu', start: 10, in: 20, out: 30, transition: { kind: 'crossfade', duration: 1 } }] });
    const plan = compile(p, opts);
    const seg = plan.segments[0].args;
    expect(seg).not.toContain('-hwaccel');
    expect(seg.slice(seg.indexOf('-i') + 1, seg.indexOf('-i') + 6)).toEqual(['source/music.mp3', '-f', 'lavfi', '-t', expect.any(String)]);
    expect(seg.join(' ')).toContain('color=c=black:s=1920x1080:r=30');
    expect(seg[seg.indexOf('-filter_complex') + 1]).toMatch(/^\[1:v\]fps=30,setsar=1,format=yuv420p\[v\];\[0:a\]/);
    const tr = plan.segments[1].args.join(' ');
    expect(tr).toContain('[1:v]fps=30,setsar=1,format=yuv420p');
    expect(tr).toContain('[3:v]fps=30,setsar=1,format=yuv420p');
    expect(tr).toMatch(/\[0:a\]atrim.*\[2:a\]atrim/);
  });

  it('B with no media before its in-point holds its first frame', () => {
    const p = Project.parse({ ...base(), clips: [{ id: 'a', trackId: 'V1', mediaId: 'm1', start: 0, in: 30, out: 40 }, { id: 'b', trackId: 'V1', mediaId: 'm1', start: 10, in: 0.2, out: 10, transition: { kind: 'crossfade', duration: 1 } }] });
    const tr = compile(p, opts).segments[1].args.join(' ');
    expect(tr).toContain('tpad=start_mode=clone:start_duration=0.3');
    expect(tr).toContain('xfade=transition=fade');
  });

  it('a muted main track renders silent, with or without music under it', () => {
    let p = applyOps(base(), [{ op: 'set_track', trackId: 'V1', patch: { muted: true } }]);
    expect(compile(p, opts).final.args.join(' ')).toContain('[0:a]volume=0[aout]');
    p = applyOps(p, [{ op: 'add_clip', clip: { trackId: 'A2', mediaId: 'mu', in: 0, out: 30, start: 5 } }]);
    const g = compile(p, opts).final.args.join(' ');
    expect(g).toContain('[0:a]volume=0,asplit=2[voice][key]');
    expect(g).toContain('adelay=5000');
  });

  it('sound effects are mixed after the music ducking, without fades', () => {
    const p0 = base();
    p0.media.push({ id: 'fx', path: 'sfx/whoosh-v2.wav', role: 'sfx', kind: 'audio', name: 'whoosh', duration: 0.75, width: 0, height: 0, fps: 0, hasAudio: true, analyzed: [] });
    const p = applyOps(p0, [
      { op: 'add_track', track: { id: 'SFX', kind: 'audio', name: 'مؤثرات' } },
      { op: 'add_clip', clip: { trackId: 'SFX', mediaId: 'fx', in: 0, out: 0.75, start: 12, volume: 0.6 } },
      { op: 'add_clip', clip: { trackId: 'A2', mediaId: 'mu', in: 0, out: 30, start: 0 } },
    ]);
    const g = compile(p, opts).final.args.join(' ');
    expect(g).toMatch(/volume=0\.6,adelay=12000:all=1\[sx\d+\]/);
    expect(g).not.toMatch(/afade[^;]*\[sx/);
    expect(g).toContain('[voice][ducked]amix=inputs=2:normalize=0:duration=first,anull[premix]');
    // levelled by one fixed gain (measured beforehand) and a limiter, so fades and volume keys stay as they are
    expect(g).toMatch(/\[premix\]\[sx\d+\]amix=inputs=2:normalize=0:duration=first,volume=\{\{gain\}\}dB,alimiter=/);
    expect(g).not.toContain('loudnorm');
    // measured at the same point of the mix
    expect(compile(p, opts).measure!.args.join(' ')).toMatch(/\[premix\]\[sx\d+\]amix=inputs=2:normalize=0:duration=first,apad=whole_dur=3,loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json\[aout\]/);
    // and the bed that gets ducked doesn't contain it
    expect(g).toMatch(/\[ma\d+\]amix=inputs=1:normalize=0\[bed\]/);
  });

  it('grade and framing filters', () => {
    expect(gradeFilters({ lut: 'luts/x.cube', lutMix: 0.5, exposure: 0, contrast: 1.1, saturation: 1, gamma: 1, temperature: 5600 }).join(',')).toBe(
      "split[gA][gB];[gB]lut3d=file='luts/x.cube':interp=trilinear[gL];[gL][gA]blend=all_mode=normal:all_opacity=0.5,eq=brightness=0:contrast=1.1:saturation=1:gamma=1,colortemperature=temperature=5600",
    );
    // 16:9 source into 9:16 frame: cover then crop around the focus
    expect(framingFilters({ width: 1920, height: 1080 }, undefined, 1080, 1920)).toEqual(['scale=3414:1920:flags=lanczos', 'crop=1080:1920:1167:0']);
    const kf = framingFilters({ width: 1920, height: 1080 }, { scale: 1, x: 0.5, y: 0.5, keyframes: [{ t: 0, scale: 1, x: 0.5, y: 0.5 }, { t: 2, scale: 1.5, x: 0.3, y: 0.4 }] }, 1920, 1080);
    expect(kf[0]).toContain('eval=frame');
    // a key's curve reaches the expression: hold keeps the first value until the next key
    const held = framingFilters({ width: 1920, height: 1080 }, { scale: 1, x: 0.5, y: 0.5, keyframes: [{ t: 0, scale: 1, x: 0.5, y: 0.5, ease: 'hold' }, { t: 2, scale: 1.5, x: 0.5, y: 0.5 }] }, 1920, 1080);
    expect(held[0]).not.toEqual(kf[0]);
  });

  it('static captions become one image stream; animated text stays a separate overlay', () => {
    let p = applyOps(base(), [{ op: 'add_track', track: { id: 'CAP', kind: 'text', name: 'cap' } }]);
    p = applyOps(p, [
      { op: 'add_text', trackId: 'CAP', text: 'a', start: 1, duration: 1, style: { animation: 'none' } },
      { op: 'add_text', trackId: 'CAP', text: 'b', start: 2.5, duration: 1, style: { animation: 'none' } },
      { op: 'add_text', trackId: 'CAP', text: 'c', start: 4, duration: 1, style: { animation: 'none' } },
      { op: 'add_text', text: 'title', start: 0, duration: 3 },
    ]);
    const plan = compile(p, { ...opts, textImage: (c) => `cache/text/${c.text}.png`, blankImage: 'cache/text/blank.png', lutFile: () => 'cache/luts/x.cube' });
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].body.trim().split('\n')).toEqual([
      "file 'text/blank.png'", 'duration 1',
      "file 'text/a.png'", 'duration 1',
      "file 'text/blank.png'", 'duration 0.5',
      "file 'text/b.png'", 'duration 1',
      "file 'text/blank.png'", 'duration 0.5',
      "file 'text/c.png'", 'duration 1',
      "file 'text/blank.png'", 'duration 55',
      "file 'text/blank.png'",
    ]);
    const args = plan.final.args.join(' ');
    expect(args.match(/overlay=/g)).toHaveLength(2); // the stream + the animated title
  });

  it('baked LUT replaces split/blend', () => {
    expect(gradeFilters({ lut: 'luts/x.cube', lutMix: 0.5, exposure: 0, contrast: 1, saturation: 1, gamma: 1, temperature: 6500 }, () => 'cache/luts/b.cube')).toEqual([
      "lut3d=file='cache/luts/b.cube':interp=trilinear",
    ]);
  });
});

describe('layer order', () => {
  it('text stays above b-roll and graphics that start later, as in the editor preview', () => {
    const p = applyOps(base(), [
      { op: 'add_text', text: 'كابشن', start: 1, duration: 6 },
      { op: 'add_clip', clip: { trackId: 'V2', mediaId: 'm1', in: 30, out: 34, start: 3 } },
      { op: 'add_track', track: { id: 'FX', kind: 'overlay', name: 'fx' } },
      { op: 'add_clip', clip: { trackId: 'FX', graphic: 'graphics/x', in: 0, out: 2, start: 4 } },
    ]);
    const args = compile(p, { ...opts, textImage: () => 'cache/text/t.png', graphicVideo: () => 'cache/graphics/g.mov' }).final.args;
    const inputs = args.filter((_, i) => args[i - 1] === '-i');
    expect(inputs.slice(1)).toEqual(['source/a.mp4', 'cache/graphics/g.mov', 'cache/text/t.png']);
  });
  it('export options: range cut after the filters, H.265, smaller files, sound only', () => {
    const p = base();
    const full = compile(p, opts).final;
    expect(full.args).toContain('copy');
    const part = compile(p, { ...opts, range: [10, 25] }).final;
    expect(part.duration).toBe(15);
    expect(part.args).not.toContain('copy'); // a stream copy can't cut on any frame
    const at = part.args.indexOf('-ss');
    expect(part.args.slice(at, at + 4)).toEqual(['-ss', '10', '-t', '15']);
    expect(at).toBeGreaterThan(part.args.indexOf('-filter_complex'));
    expect(compile(p, { ...opts, range: [0, 60] }).final.args).toContain('copy'); // the whole edit is no range
    const hevc = compile(p, { ...opts, codec: 'h265' }).final.args;
    expect(hevc).toContain('hevc_nvenc');
    expect(hevc).toContain('hvc1');
    expect(compile(p, { ...opts, nvenc: false, codec: 'h265' }).final.args).toContain('libx265');
    const small = compile(p, { ...opts, level: 'small' }).final.args;
    expect(small[small.indexOf('-cq') + 1]).toBe('25');
    const mp3 = compile(p, { ...opts, audio: 'mp3', output: 'renders/a.mp3' }).final.args;
    expect(mp3).toContain('-vn');
    expect(mp3).toContain('libmp3lame');
    expect(mp3).not.toContain('-c:v');
    expect(mp3.at(-1)).toBe('renders/a.mp3');
    expect(compile(p, { ...opts, audio: 'wav' }).final.args).toContain('pcm_s16le');
  });
  it('picture on the main track: crop and flip on the source, fit with bars, rotation about the centre', () => {
    const p = applyOps(base(), [{ op: 'update_clip', clipId: 'c0', patch: { picture: { fit: 'fit', rotate: 90, flipX: true, crop: { l: 0.25, r: 0.25 } } } }]);
    const vf = compile(p, opts).segments[0].args.find((a) => a.includes('[0:v]'))!;
    expect(vf).toContain('crop=w=trunc(iw*0.5/2)*2:h=trunc(ih*1/2)*2:x=trunc(iw*0.25):y=trunc(ih*0)');
    expect(vf).toContain('hflip');
    // 1280x1440 after the crop, fitted into 1920x1080: 960x1080 on black bars
    expect(vf).toContain('scale=960:1080:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black');
    expect(vf).toContain('rotate=1.570796:ow=1920:oh=1080:c=black');
    expect(vf.indexOf('crop=w')).toBeLessThan(vf.indexOf('hflip'));
    expect(vf.indexOf('pad=')).toBeLessThan(vf.indexOf('rotate='));
  });

  it('fit on blurred bars: a soft copy covers the frame, the picture (turned on its own) sits in the middle; labels stay unique across a transition', () => {
    let p = applyOps(base(), [{ op: 'split', clipId: 'c0', at: 30 }]);
    const [a, b] = mainClipsOf(p);
    p = applyOps(p, [
      { op: 'update_clip', clipId: a.id, patch: { picture: { fit: 'fit', bars: 'blur', rotate: 10 } } },
      { op: 'update_clip', clipId: b.id, patch: { picture: { fit: 'fit', bars: 'blur' } } },
      { op: 'set_transition', clipIds: [b.id], kind: 'crossfade', duration: 1 },
    ]);
    const plan = compile(p, opts);
    const vf = plan.segments[0].args.find((x) => x.includes('[0:v]'))!;
    expect(vf).toMatch(/^\[0:v\]split=2\[pf1\]\[pb1\];\[pb1\]scale=160:90:force_original_aspect_ratio=increase,crop=160:90,format=gbrp,boxblur=8:3,scale=1920:1080/);
    expect(vf).toContain("[pf1]scale=1920:1080:flags=lanczos,format=rgba,rotate=0.174533:ow='rotw(0.174533)':oh='roth(0.174533)':c=none[pp1]");
    expect(vf).toContain("[pg1][pp1]overlay=x='(main_w-overlay_w)/2':y='(main_h-overlay_h)/2',fps=30");
    expect(vf).not.toContain(':c=black'); // the frame itself is not turned
    const xf = plan.segments.find((s) => s.clipId.endsWith(':in'))!.args.find((x) => x.includes('xfade'))!;
    const labels = xf.match(/\[p[fbgp]\d+\]/g)!;
    expect(new Set(labels.map((l) => l.slice(3)))).toHaveLength(2); // one tag per clip in the blend
  });

  it('b-roll picture-in-picture: sized, turned, see-through, placed off centre; and sound fades', () => {
    const p = applyOps(base(), [
      { op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', start: 5, in: 0, out: 4 } },
      { op: 'update_clip', clipId: 'b', patch: { place: { scale: 0.35, dx: 0.3, dy: -0.3 }, picture: { rotate: -10, opacity: 0.8 }, fadeIn: 1, fadeOut: 0.5 } },
    ]);
    const args = compile(p, opts).final.args, graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('scale=w=trunc(iw*0.35/2)*2:h=trunc(ih*0.35/2)*2');
    expect(graph).toContain("rotate=-0.174533:ow='rotw(-0.174533)':oh='roth(-0.174533)':c=none");
    expect(graph).toContain('colorchannelmixer=aa=0.8');
    expect(graph).toContain("overlay=x='(main_w-overlay_w)/2+576':y='(main_h-overlay_h)/2+-324'");
    expect(graph).toContain('afade=t=in:d=1,afade=t=out:st=3.5:d=0.5');
  });
});

describe('keyframes of place, opacity and volume', () => {
  it('main track: opacity over black by frame commands, volume as an expression; both seen from the piece start', () => {
    const p = applyOps(base(), [{ op: 'update_clip', clipId: 'c0', patch: { anim: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 1 }], volume: [{ t: 0, v: 1 }, { t: 2, v: 0.5 }] } } }]);
    const plan = compile(p, opts);
    const graph = plan.segments[0].args.find((a) => a.includes('[0:v]'))!;
    const cmd = plan.files.find((f) => f.path.startsWith('cache/anim/'))!;
    const name = graph.match(new RegExp(`sendcmd=f=${cmd.path},(colorchannelmixer@o\\d+)=rr=0:gg=0:bb=0`))![1];
    expect(cmd.body.split('\n')[1]).toBe(`0.0333 ${name} rr 0.003, ${name} gg 0.003, ${name} bb 0.003;`);
    expect(cmd.body.trim().split('\n').length).toBe(31); // a line per frame while it changes, then nothing
    expect(graph).toContain("volume='if(lt(t,0),1,if(lt(t,2),1+(-0.5)*");
  });
  it('a layer grows, slides and fades in: scale per frame padded to its largest, overlay position over the timeline', () => {
    const p = applyOps(base(), [
      { op: 'add_clip', clip: { id: 'b', trackId: 'V2', mediaId: 'm1', start: 5, in: 0, out: 4 } },
      { op: 'update_clip', clipId: 'b', patch: { anim: { scale: [{ t: 0, v: 0.3 }, { t: 2, v: 0.5 }], dx: [{ t: 0, v: -0.3 }, { t: 2, v: 0.3 }], opacity: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }] } } },
    ]);
    const args = compile(p, opts).final.args, graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain("scale=w='max(2,2*trunc(iw*(if(lt(t,0),0.3,if(lt(t,2),0.3+(0.2)*");
    expect(graph).toContain("pad=w=962:h=542:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame");
    expect(graph).toContain("overlay=x='(main_w-overlay_w)/2+(if(lt((t-5),0),-0.3,");
    expect(graph).toMatch(/sendcmd=f=cache\/anim\/\w+\.cmd,colorchannelmixer@o\d+=aa=0,format=yuva420p/);
    expect(graph).not.toContain('scale=w=trunc(iw*'); // no fixed size on top of the moving one
  });
});
