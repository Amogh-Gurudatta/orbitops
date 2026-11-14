// Express application: security headers, CORS, parsers, logging, rate limit, API router, optional SPA hosting.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { ServerContext } from './context.js';
import { errorHandler } from './http/errors.js';
import { createApiRouter, type ApiOptions } from './http/routes/index.js';
import { WEB_DIST } from './paths.js';

const TILE_HOSTS = ['https://*.basemaps.cartocdn.com', 'https://gibs.earthdata.nasa.gov'];

/** `http://host:5173` -> `ws://host:5173`, so browsers that skip 'self' for websockets still connect. */
function websocketOrigin(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

function securityHeaders(ctx: ServerContext) {
  const { config } = ctx;
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        // Inline styles: React style props and deck.gl set them at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', ...TILE_HOSTS],
        connectSrc: ["'self'", ...config.clientOrigins.map(websocketOrigin), ...TILE_HOSTS],
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
  });
}

export function createApp(ctx: ServerContext, options: ApiOptions = {}): Express {
  const { config, log } = ctx;
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(ctx));
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(
    pinoHttp({
      logger: log,
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/metrics' },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    const ready = ctx.isReady();
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'unavailable',
      uptimeS: Math.round(process.uptime()),
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.type(ctx.metrics.contentType).send(await ctx.metrics.metrics());
  });

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'rate_limited' },
    }),
  );
  api.use(createApiRouter(ctx, options));
  app.use('/api/v1', api);

  if (config.serveWeb) mountWeb(app, ctx);

  app.use(errorHandler(log));
  return app;
}

/** Serves the built SPA; unknown non-API paths fall back to index.html for client-side routing. */
function mountWeb(app: Express, ctx: ServerContext): void {
  const index = resolve(WEB_DIST, 'index.html');
  if (!existsSync(index)) {
    ctx.log.warn(
      { dist: WEB_DIST },
      'SERVE_WEB is on but packages/web/dist is missing; run the web build',
    );
    return;
  }
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/metrics' || req.path === '/healthz') {
      next();
      return;
    }
    res.sendFile(index);
  });
}
