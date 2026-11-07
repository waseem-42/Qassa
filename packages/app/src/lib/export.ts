export type ExportQuality = 'preview' | 'final';
export interface ExportIssue { code: string; message: string; clipId?: string; mediaId?: string; path?: string }
export interface ExportPreflight {
  ready: boolean; rev: number; snapshotId: string; quality: ExportQuality;
  blockers: ExportIssue[]; warnings: ExportIssue[];
  resources: { kind: 'media' | 'proxy' | 'graphic' | 'lut' | 'font' | 'browser'; path: string; status: 'ready' | 'missing' | 'unverified'; mediaId?: string; clipId?: string }[];
}

/** A check applies only to the exact edit and requested quality it inspected. */
export function canSubmitExport(check: ExportPreflight | undefined, rev: number, quality: ExportQuality): boolean {
  return !!check?.ready && !check.blockers.length && check.rev === rev && check.quality === quality;
}

/** "1:23.5", "01:02:03" or "83.5" → seconds; undefined when it isn't a time. */
export function parseTimecode(text: string): number | undefined {
  const t = text.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,٫]/g, '.');
  if (!/^\d+(?:\.\d+)?$|^\d+:\d{1,2}(?:\.\d+)?$|^\d+:\d{1,2}:\d{1,2}(?:\.\d+)?$/.test(t)) return undefined;
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some((x) => x >= 60)) return undefined;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}
