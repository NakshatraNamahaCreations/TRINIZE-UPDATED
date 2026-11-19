/**
 * Client for the Trinize API (backend/). Set VITE_API_URL to use it, e.g. in owner-portal/.env.local:
 *   VITE_API_URL=http://localhost:4000
 * Left empty, the portal runs on its built-in demo data, as before.
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
export const LIVE = API_URL !== '';

/** An error the server explained: `code` is stable, `message` is ready to show. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let tokens = null; // { access, refresh }
let onTokens = () => {};
let refreshing = null;

/** The auth provider owns storage; it hands the client its tokens and hears about every change. */
export function bindTokens(current, changed) {
  tokens = current;
  onTokens = changed;
}
export function setTokens(t) {
  tokens = t;
  onTokens(t);
}

const raw = (method, path, body, auth = true) =>
  fetch(API_URL + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth && tokens ? { authorization: 'Bearer ' + tokens.access } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

/** one refresh at a time, however many requests found their token expired */
function refresh() {
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

export async function api(method, path, body, opts = {}) {
  const auth = opts.auth ?? true;
  let res;
  try {
    res = await raw(method, path, body, auth);
    if (res.status === 401 && auth && tokens && (await refresh())) res = await raw(method, path, body, auth);
  } catch {
    throw new ApiError(0, 'offline', 'Can’t reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined;
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, j?.error?.code ?? 'error', j?.error?.message ?? 'Something went wrong.');
  return j;
}
