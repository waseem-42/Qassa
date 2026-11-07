// The قَصّة mark and the editor's few drawn icons. The mark: two clips with a cut between them,
// the gold playhead standing in the cut (brand/qassa-mark-on-dark.svg). Icons are 1.5px strokes in
// the text colour; everything else in the UI is a Unicode glyph (see the design system's README).

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="4" y="20" width="23" height="24" rx="5" className="fill-ink-200" />
      <rect x="37" y="20" width="23" height="24" rx="5" className="fill-ink-200" />
      <path d="M25.5 7h13l-6.5 7.5z" className="fill-accent" />
      <rect x="30.5" y="12" width="3" height="45" rx="1.5" className="fill-accent" />
    </svg>
  );
}

/** Mark + the name, set live in the display face. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="flex items-center" style={{ gap: size * 0.25 }}>
      <Mark size={size} />
      <span className="font-display font-bold leading-none text-ink-200" style={{ fontSize: size * 0.82 }}>قَصّة</span>
    </span>
  );
}

const PATHS = {
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  edit: 'm15 4 5 5 M4 20l5-1L21 7l-5-5L4 14z',
  restore: 'M4 10a8 8 0 1 1 1 8 M4 4v6h6 M12 8v5l3 2',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list: 'M9 6h12 M9 12h12 M9 18h12 M3 6h1 M3 12h1 M3 18h1',
  film: 'M4 4h16v16H4z M8 4v16 M16 4v16 M4 9h4 M4 15h4 M16 9h4 M16 15h4',
  sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M20 2v4 M18 4h4',
  text: 'M4 5h16 M12 5v15 M8 20h8',
  sliders: 'M4 7h7 M15 7h5 M4 17h3 M11 17h9 M11 4v6 M7 14v6',
  comment: 'M4 4h16v13H9l-5 4z M8 8h8 M8 12h5',
  play: 'm9 5 11 7-11 7z',
  heart: 'M12 20s-7.2-4.4-9.1-8.9C1.6 7.9 3.5 4.5 6.9 4.5c2.1 0 3.4 1.2 5.1 3.2 1.7-2 3-3.2 5.1-3.2 3.4 0 5.3 3.4 4 6.6C19.2 15.6 12 20 12 20z',
  pause: 'M8 5v14 M16 5v14',
  cut: 'M4 4 20 20 M14 10l6-6 M8 14l-2 2 M7 7a3 3 0 1 1-4-4 3 3 0 0 1 4 4 M7 17a3 3 0 1 1-4 4 3 3 0 0 1 4-4',
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
  folder: 'M3 6h7l2 3h9v11H3z M3 6V4h7l2 2h7v3',
  plus: 'M12 5v14 M5 12h14',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5',
  close: 'm6 6 12 12 M18 6 6 18',
  expand: 'M9 3H3v6 M15 3h6v6 M3 15v6h6 M21 15v6h-6',
  chevron: 'm9 5 7 7-7 7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  keyboard: 'M3 6h18v13H3z M7 10h.01 M11 10h.01 M15 10h.01 M18 10h.01 M7 14h.01 M10 15h7',
  speaker: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M15.5 9a4 4 0 0 1 0 6 M18 6.5a7.5 7.5 0 0 1 0 11',
  speakerOff: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M16 9.5l5 5 M21 9.5l-5 5',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  eyeOff: 'M2.5 12s3.5-6.5 9.5-6.5c2 0 3.7.7 5.1 1.7 M21.5 12s-3.5 6.5-9.5 6.5c-2 0-3.7-.7-5.1-1.7 M4 20 20 4',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.5-1-2.6 0-1 .8-1.7 1.8-1.7h2.2a3.7 3.7 0 0 0 3.7-3.7C20.5 6.6 16.7 3.5 12 3.5z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01',
  upload: 'M12 16V5 M7.5 9.5 12 5l4.5 4.5 M5 15.5v3h14v-3',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4 M6 4h4v8a2 2 0 0 0 4 0V4h4 M6 8h4 M14 8h4',
  freeze: 'M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M10 4.5l2 2 2-2 M10 19.5l2-2 2 2',
  reverse: 'M9 7H4V2 M4.5 7A8.5 8.5 0 1 1 3.5 13',
  detach: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M15 8l6 8 M21 8l-6 8',
  copy: 'M8 8h12v12H8z M16 8V4H4v12h4',
  shapes: 'M4 4h7v7H4z M17.5 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M7.5 14l4 7h-8z M14 14h7v7h-7z',
  image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 8.5h.01',
  camera: 'M4 8h3.5L9 5.5h6L16.5 8H20v11H4z M12 10.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
  paste: 'M8 4h8v3H8z M16 5h3v16H5V5h3 M9 12h6 M9 16h4',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
} as const;

export function Icon({ name, size = 14 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A small turning ring for work in progress (the analysis, an upload). */
export function Spinner({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin motion-reduce:animate-none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" className="stroke-ink-700" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-accent" />
    </svg>
  );
}
