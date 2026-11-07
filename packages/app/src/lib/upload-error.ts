/** A short Arabic reason for a failed import; the raw server text stays available as details. */
export function uploadError(raw = ''): { text: string; details?: string } {
  if (/ffprobe failed|invalid data|moov atom|could not find codec|end of file/i.test(raw)) {
    return { text: 'تعذّرت قراءة الملف: يبدو تالفًا أو لم يكتمل تنزيله. افتحه في مشغّل فيديو للتأكد، أو صدّره من جديد ثم أضفه.', details: raw };
  }
  return { text: raw || 'تعذّر رفع الملف.' };
}
