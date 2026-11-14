// Auth cookie names and helpers. Cookies are first-party: the SPA and API share one origin (or a dev proxy).
import type { CookieOptions, Response } from 'express';
import { ACCESS_TTL_MS, REFRESH_TTL_MS } from './tokens.js';

export const ACCESS_COOKIE = 'oo_at';
export const REFRESH_COOKIE = 'oo_rt';
const REFRESH_PATH = '/api/v1/auth';

function base(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure };
}

export function setAuthCookies(
  res: Response,
  tokens: { access: string; refresh: string },
  secure: boolean,
): void {
  res.cookie(ACCESS_COOKIE, tokens.access, { ...base(secure), path: '/', maxAge: ACCESS_TTL_MS });
  // The refresh token is only ever needed by the auth routes, so it is not sent anywhere else.
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...base(secure),
    path: REFRESH_PATH,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res: Response, secure: boolean): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(secure), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(secure), path: REFRESH_PATH });
}

/** Minimal Cookie header parser for Socket.IO handshakes (Express has cookie-parser; sockets do not). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    const raw = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '');
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}
