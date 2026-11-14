// /api/v1/auth: login, refresh, logout, me, socket-token (cookie-based sessions per the API contract).
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from '../../auth/cookies.js';
import { requireAuth } from '../../auth/middleware.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import type { AuthUser, TokenService } from '../../auth/tokens.js';
import { User, type UserDoc } from '../../models/user.js';

const LoginBody = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

export interface AuthRouterOptions {
  tokens: TokenService;
  /** Sets the Secure cookie attribute. */
  secureCookies: boolean;
  /** Login attempts per minute per IP (contract: 5). */
  loginLimitPerMinute?: number;
}

const toAuthUser = (doc: UserDoc & { _id: { toString(): string } }): AuthUser => ({
  id: doc._id.toString(),
  email: doc.email,
  name: doc.name,
  role: doc.role,
});

// Verified against when the email is unknown, so response time does not reveal which emails exist.
let decoyHash: Promise<string> | undefined;
const getDecoyHash = () => (decoyHash ??= hashPassword('orbitops-decoy-password'));

export function createAuthRouter(options: AuthRouterOptions): Router {
  const { tokens, secureCookies } = options;
  const router = Router();

  async function startSession(res: Response, user: AuthUser): Promise<void> {
    const [access, refresh] = await Promise.all([
      tokens.sign('access', user),
      tokens.sign('refresh', user),
    ]);
    setAuthCookies(res, { access, refresh }, secureCookies);
    res.json({ user });
  }

  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: options.loginLimitPerMinute ?? 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'too_many_attempts' },
  });

  router.post('/login', loginLimiter, async (req: Request, res: Response) => {
    const { email, password } = LoginBody.parse(req.body);
    const doc = await User.findOne({ email: email.toLowerCase() }).lean();
    const valid = await verifyPassword(doc?.passwordHash ?? (await getDecoyHash()), password);
    if (!doc || !valid) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    await startSession(res, toAuthUser(doc));
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const claims = await tokens.verify(token, 'refresh');
    // Reload so role changes and deleted accounts take effect at the next refresh.
    const doc = claims ? await User.findById(claims.id).lean() : null;
    if (!doc) {
      clearAuthCookies(res, secureCookies);
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    await startSession(res, toAuthUser(doc));
  });

  router.post('/logout', (_req: Request, res: Response) => {
    clearAuthCookies(res, secureCookies);
    res.status(204).end();
  });

  router.get('/me', requireAuth(tokens), (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  router.get('/socket-token', requireAuth(tokens), async (req: Request, res: Response) => {
    res.json({ token: await tokens.sign('socket', req.user as AuthUser) });
  });

  return router;
}
