import { MAIN_TRACK, type Project } from './schema.ts';

/** Speech-bearing clips, including legacy sources placed on audio tracks. Music is opt-in via transcription. */
export function speechClips(p: Project) {
  return p.clips.filter((c) => {
    const m = p.media.find((m) => m.id === c.mediaId), t = p.tracks.find((t) => t.id === c.trackId);
    return m && t && !t.muted && (m.hasAudio || m.kind === 'audio') && m.role !== 'sfx' &&
      (c.trackId === MAIN_TRACK || t.audio === 'voice' || m.role === 'source' || m.analyzed.includes('transcribe'));
  }).sort((a, b) => a.start - b.start);
}

export function speechMediaIds(p: Project): string[] {
  return [...new Set(speechClips(p).map((c) => c.mediaId!))];
}

export const TRANSCRIBE_STEPS = ['transcribe', 'silence', 'summary'];
