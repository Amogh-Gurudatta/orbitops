// Typed fetch wrapper for /api/v1: cookie credentials, JSON in/out, typed errors, and a single-flight
// POST /auth/refresh + one retry when an access token has expired (401).
import { API_BASE } from '../config.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** Seconds, from the Retry-After header (429). */
  readonly retryAfter: number | undefined;

  constructor(status: number, message: string, code?: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

/** Paths that must never trigger the refresh-and-retry path (they are the auth flow itself). */
const NO_REFRESH = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

/** The auth layer registers here to learn when a refresh failed and the session is gone. */
export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.pathname + url.search;
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const err =
        (body as { error?: unknown; message?: unknown }).error ??
        (body as { message?: unknown }).message;
      if (typeof err === 'string') message = err;
      else if (err && typeof err === 'object') {
        const detail = err as { message?: unknown; code?: unknown };
        if (typeof detail.message === 'string') message = detail.message;
        if (typeof detail.code === 'string') code = detail.code;
      }
    }
  } catch {
    // Non-JSON error body: keep the status text.
  }
  const retry = Number(res.headers.get('Retry-After'));
  return new ApiError(
    res.status,
    message,
    code,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  const hasBody = options.body !== undefined;
  return fetch(buildUrl(path, options.query), {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
}

/** One refresh at a time, however many requests hit 401 together. */
function refreshSession(): Promise<boolean> {
  refreshing ??= send('POST', '/auth/refresh', {})
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(method, path, options);
  if (res.status === 401 && !NO_REFRESH.has(path)) {
    if (await refreshSession()) res = await send(method, path, options);
    else {
      onSessionLost?.();
      throw await toApiError(res);
    }
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('DELETE', path, options),
  /** Exposed so the realtime layer can renew a socket session after the handshake is refused. */
  refresh: refreshSession,
};
