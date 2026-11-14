// Mounting point for every /api/v1 route module. Everything except /auth requires a valid session;
// individual routes add role checks.
import { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import type { ServerContext } from '../../context.js';
import { notFoundHandler } from '../errors.js';
import { createDevicesRouter, createUsersRouter } from './admin.js';
import { createAlertRulesRouter } from './alertRules.js';
import { createAlertsRouter } from './alerts.js';
import { createAnalyticsRouter } from './analytics.js';
import { createAuthRouter } from './auth.js';
import { createCommandsRouter } from './commands.js';
import { createGroundStationsRouter } from './groundStations.js';
import { createPassesRouter } from './passes.js';
import { createSatellitesRouter } from './satellites.js';
import { createSystemRouter } from './system.js';
import { createTelemetryRouter } from './telemetry.js';

export interface ApiOptions {
  loginLimitPerMinute?: number;
}

export function createApiRouter(ctx: ServerContext, options: ApiOptions = {}): Router {
  const router = Router();
  const authed = requireAuth(ctx.tokens);

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

  router.use('/satellites', authed, createSatellitesRouter(ctx));
  router.use('/ground-stations', authed, createGroundStationsRouter());
  router.use('/passes', authed, createPassesRouter());
  router.use('/telemetry', authed, createTelemetryRouter(ctx));
  router.use('/alerts', authed, createAlertsRouter(ctx));
  router.use('/alert-rules', authed, createAlertRulesRouter(ctx));
  router.use('/commands', authed, createCommandsRouter(ctx));
  router.use('/analytics', authed, createAnalyticsRouter(ctx));
  router.use('/system', authed, createSystemRouter(ctx));
  router.use('/users', authed, createUsersRouter());
  router.use('/devices', authed, createDevicesRouter());

  router.use(notFoundHandler);
  return router;
}
