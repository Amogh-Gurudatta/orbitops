// Mounting point for every /api/v1 route module. Add new routers here (satellites, telemetry, alerts,
// commands, analytics, system, users, devices); each receives the service context.
import { Router } from 'express';
import type { ServerContext } from '../../context.js';
import { notFoundHandler } from '../errors.js';
import { createAuthRouter } from './auth.js';

export interface ApiOptions {
  loginLimitPerMinute?: number;
}

export function createApiRouter(ctx: ServerContext, options: ApiOptions = {}): Router {
  const router = Router();

  router.use(
    '/auth',
    createAuthRouter({
      tokens: ctx.tokens,
      secureCookies: ctx.config.isProduction,
      ...(options.loginLimitPerMinute !== undefined
        ? { loginLimitPerMinute: options.loginLimitPerMinute }
        : {}),
    }),
  );

  router.use(notFoundHandler);
  return router;
}
