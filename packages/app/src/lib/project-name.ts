/** A safe, available folder name; the creator's title is kept separately. */
export function projectName(title: string, taken: string[]) {
  const base = title.replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/-{2,}/g, '-').replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 56).replace(/[._-]+$/, '') || 'مشروع';
  const used = new Set(taken.map((t) => t.toLocaleLowerCase()));
  let name = base;
  for (let i = 2; used.has(name.toLocaleLowerCase()); i++) name = `${base}-${i}`;
  return { name, displayName: name === title ? undefined : title };
}
