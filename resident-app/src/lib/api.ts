/**
 * Client for the Trinize API (backend/). Set EXPO_PUBLIC_API_URL to use it, e.g.
 *   EXPO_PUBLIC_API_URL=http://localhost:4000        (web / emulator)
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:4000     (a phone on the same Wi-Fi: the PC's address)
 * Left empty, the app runs on its built-in demo data with the fixed code 123456.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
export const LIVE = API_URL !== '';

export type Tokens = { access: string; refresh: string };

/** An error the server explained: `code` is stable, `message` is ready to show. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let tokens: Tokens | null = null;
let onTokens: (t: Tokens | null) => void = () => {};
let refreshing: Promise<boolean> | null = null;

/** for a WebSocket, which cannot send the header: the current access token, if signed in */
export const accessToken = () => tokens?.access ?? null;

/** The auth store owns persistence; it hands the client its tokens and hears about every change. */
export function bindTokens(current: Tokens | null, changed: (t: Tokens | null) => void) {
  tokens = current;
  onTokens = changed;
}
export function setTokens(t: Tokens | null) {
  tokens = t;
  onTokens(t);
}

async function raw(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
  return fetch(API_URL + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth && tokens ? { authorization: 'Bearer ' + tokens.access } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** One refresh at a time, however many requests found their token expired. */
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      if (!tokens) return false;
      const res = await raw('POST', '/v1/auth/refresh', { refreshToken: tokens.refresh }, false);
      if (!res.ok) { setTokens(null); return false; } // signed out elsewhere, or expired
      const j = await res.json();
      setTokens({ access: j.accessToken, refresh: j.refreshToken });
      return true;
    } catch {
      return false; // offline: keep the tokens and let the caller report it
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
  // blocked by the society office: there is nothing left to use, so the session ends here and the reason is shown
  if (res.status === 403 && j?.error?.code === 'account_blocked' && auth && tokens) setTokens(null);
  if (!res.ok) throw new ApiError(res.status, j?.error?.code ?? 'error', j?.error?.message ?? 'Something went wrong.');
  return j as T;
}

export const currentAccess = () => tokens?.access ?? '';
