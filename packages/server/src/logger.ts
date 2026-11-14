// pino logger: pretty-printed in an interactive dev terminal, JSON elsewhere. Credentials are redacted.
import { pino, type Logger } from 'pino';
import type { Config } from './config.js';

export type { Logger };

export function createLogger(
  config: Pick<Config, 'isProduction' | 'logLevel' | 'nodeEnv'>,
): Logger {
  const pretty = !config.isProduction && config.nodeEnv !== 'test' && process.stdout.isTTY;
  return pino({
    level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}
