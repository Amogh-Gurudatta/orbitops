// Error handling: zod failures become 400s with field details; everything else is a generic 500/4xx.
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import type { Logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'validation_failed', details: z.flattenError(err) });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // body-parser / http-errors carry a 4xx status for malformed or oversized bodies.
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: status === 413 ? 'payload_too_large' : 'bad_request' });
      return;
    }
    log.error({ err }, 'unhandled request error');
    res.status(500).json({ error: 'internal_error' });
  };
}
