/** Partial stored settings are neutral when their effective values match the defaults. */
export function changedValue(value: unknown, defaults: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0 && JSON.stringify(value) !== JSON.stringify(defaults);
  if (typeof value === 'object') return Object.entries(value).some(([key, v]) => changedValue(v, (defaults as Record<string, unknown> | undefined)?.[key]));
  return value !== defaults;
}
