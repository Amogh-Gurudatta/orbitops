// Express guards: authenticate from the access cookie (or a Bearer header) and enforce roles.
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@orbitops/shared';
import { ACCESS_COOKIE } from './cookies.js';
import type { AuthUser, TokenService } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function accessTokenFrom(req: Request): string | undefined {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

export function requireAuth(tokens: TokenService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await tokens.verify(accessTokenFrom(req), 'access');
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    req.user = user;
    next();
  };
}

/** Use after requireAuth. Roles are matched exactly: list every role that may pass (e.g. operator, admin). */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
