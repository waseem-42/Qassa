export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body?: { code?: string; rev?: number; preflight?: unknown }) { super(message); this.name = 'ApiError'; }
}

async function handle<T>(r: Response): Promise<T> {
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(typeof body === 'string' ? body : body.error ?? r.statusText, r.status, typeof body === 'object' ? body : undefined);
  return body as T;
}

export const api = {
  get: <T = any>(path: string) => fetch(path).then((r) => handle<T>(r)),
  patch: <T = any>(path: string, body: unknown) =>
    fetch(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  delete: <T = any>(path: string) => fetch(path, { method: 'DELETE' }).then((r) => handle<T>(r)),
  post: <T = any>(path: string, body: unknown = {}) =>
    fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => handle<T>(r)),
  upload: <T = any>(path: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f, f.name);
    return fetch(path, { method: 'POST', body: fd }).then((r) => handle<T>(r));
  },
};

export const projectPath = (name: string) => `/api/projects/${encodeURIComponent(name)}`;

/** URL for a project-relative file served by the server. */
export function fileUrl(project: string, rel?: string): string | undefined {
  if (!rel || /^[A-Za-z]:|^\//.test(rel)) return undefined;
  return `/files/${encodeURIComponent(project)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}
