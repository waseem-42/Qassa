export function rowAtY<T extends { top: number; bottom: number }>(rows: T[], y: number): T | undefined {
  return rows.find((r) => y >= r.top && y < r.bottom);
}
