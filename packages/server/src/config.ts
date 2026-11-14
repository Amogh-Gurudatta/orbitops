// Environment configuration: parsed and validated once at boot with zod; nothing else reads process.env.
import { z } from 'zod';

const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me-before-deploying';
const DEV_DEVICE_API_KEY = 'dev-simulator-key-change-me';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  MONGODB_URI: z
    .string()
    .min(1)
    .default('mongodb://localhost:27017/orbitops?replicaSet=rs0&directConnection=true'),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  JWT_SECRET: z.string().optional(),
  DEVICE_API_KEY: z.string().min(8).optional(),
  PERSIST_HZ: z.coerce.number().positive().max(10).default(2),
  RAW_TTL_HOURS: z.coerce.number().positive().default(6),
  SERVE_WEB: z.stringbool().default(false),
  SEED_DEMO: z.stringbool().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEVICE_EVENTS_PER_SEC: z.coerce.number().int().positive().default(3000),
  DEVICE_BURST_EVENTS: z.coerce.number().int().positive().default(6000),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  mongoUri: string;
  clientOrigins: string[];
  jwtSecret: string;
  deviceApiKey: string | undefined;
  persistHz: number;
  rawTtlHours: number;
  serveWeb: boolean;
  seedDemo: boolean;
  trustProxy: number;
  logLevel: string;
  deviceEventsPerSec: number;
  deviceBurstEvents: number;
  /** Non-fatal problems found while loading (logged by the caller once the logger exists). */
  warnings: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const warnings: string[] = [];

  let jwtSecret = e.JWT_SECRET;
  if (isProduction) {
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be set to at least 32 characters in production');
    }
  } else if (!jwtSecret || jwtSecret.length < 32) {
    warnings.push(
      'JWT_SECRET missing or shorter than 32 chars: using an insecure development default',
    );
    jwtSecret = DEV_JWT_SECRET;
  }

  const seedDemo = e.SEED_DEMO ?? !isProduction;
  const deviceApiKey = e.DEVICE_API_KEY ?? (isProduction ? undefined : DEV_DEVICE_API_KEY);
  if (seedDemo && !e.DEVICE_API_KEY && !isProduction) {
    warnings.push('DEVICE_API_KEY not set: seeding the well-known development device key');
  }

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    mongoUri: e.MONGODB_URI,
    clientOrigins: e.CLIENT_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    jwtSecret,
    deviceApiKey,
    persistHz: e.PERSIST_HZ,
    rawTtlHours: e.RAW_TTL_HOURS,
    serveWeb: e.SERVE_WEB,
    seedDemo,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    deviceEventsPerSec: e.DEVICE_EVENTS_PER_SEC,
    deviceBurstEvents: e.DEVICE_BURST_EVENTS,
    warnings,
  };
}
