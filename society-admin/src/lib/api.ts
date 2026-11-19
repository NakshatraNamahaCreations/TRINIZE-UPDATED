/**
 * Client for the Trinize API (backend/). Set VITE_API_URL to use it, e.g. in society-admin/.env.local:
 *   VITE_API_URL=http://localhost:4000
 * Left empty, the console runs on its built-in demo data, as before.
 */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
export const LIVE = API_URL !== '';

export type Tokens = { access: string; refresh: string };

/** An error the server explained: `code` is stable, `message` is ready to show. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let tokens: Tokens | null = null;
let onTokens: (t: Tokens | null) => void = () => {};
let refreshing: Promise<boolean> | null = null;

/** The auth provider owns storage; it hands the client its tokens and hears about every change. */
export function bindTokens(current: Tokens | null, changed: (t: Tokens | null) => void) {
  tokens = current;
  onTokens = changed;
}
export function setTokens(t: Tokens | null) {
  tokens = t;
  onTokens(t);
}

const raw = (method: string, path: string, body?: unknown, auth = true) =>
  fetch(API_URL + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth && tokens ? { authorization: 'Bearer ' + tokens.access } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

/** one refresh at a time, however many requests found their token expired */
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      if (!tokens) return false;
      const res = await raw('POST', '/v1/auth/refresh', { refreshToken: tokens.refresh }, false);
      if (!res.ok) { setTokens(null); return false; }
      const j = await res.json();
      setTokens({ access: j.accessToken, refresh: j.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const auth = opts.auth ?? true;
  let res: Response;
  try {
    res = await raw(method, path, body, auth);
    if (res.status === 401 && auth && tokens && (await refresh())) res = await raw(method, path, body, auth);
  } catch {
    throw new ApiError(0, 'offline', 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, j?.error?.code ?? 'error', j?.error?.message ?? 'Something went wrong.');
  return j as T;
}

/** Upload a photo or PDF (message attachments); answers with its address on the server. */
export async function upload(file: File): Promise<string> {
  // a cheap authenticated call first, so an expired token is refreshed before the upload
  await api('GET', '/v1/notifications');
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(API_URL + '/v1/uploads', { method: 'POST', headers: { authorization: 'Bearer ' + (tokens?.access ?? '') }, body: form }).catch(() => null);
  const j = res ? await res.json().catch(() => null) : null;
  if (!res?.ok) throw new ApiError(res?.status ?? 0, j?.error?.code ?? 'upload_failed', j?.error?.message ?? 'The file couldn’t be uploaded. Try again.');
  return j.url as string;
}

/** for downloads, which the browser fetches outside api() */
export const accessToken = () => tokens?.access ?? '';
