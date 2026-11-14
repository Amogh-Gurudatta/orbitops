// Boot-time collection setup: Mongoose cannot create time-series collections, so we do it explicitly.
import { nativeDb } from './connect.js';
import * as models from '../models/index.js';

export const TELEMETRY = 'telemetry';
export const TELEMETRY_1M = 'telemetry_1m';

const NAMESPACE_EXISTS = 48;

export interface CollectionOptions {
  rawTtlHours: number;
}

async function ensureTelemetry(ttlSeconds: number): Promise<void> {
  const db = nativeDb();
  const [existing] = await db.listCollections({ name: TELEMETRY }).toArray();
  if (!existing) {
    try {
      await db.createCollection(TELEMETRY, {
        timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
        expireAfterSeconds: ttlSeconds,
      });
    } catch (err) {
      if ((err as { code?: number }).code !== NAMESPACE_EXISTS) throw err;
    }
  } else {
    const current = (existing as { options?: { expireAfterSeconds?: number } }).options
      ?.expireAfterSeconds;
    if (current !== ttlSeconds) {
      await db.command({ collMod: TELEMETRY, expireAfterSeconds: ttlSeconds });
    }
  }
  await db.collection(TELEMETRY).createIndex({ 'meta.satId': 1, seq: 1 });
}

/** Rollups are kept this long; the longest query window (7-day heatmap plus a 24 h baseline) fits easily. */
const ROLLUP_TTL_SECONDS = 30 * 24 * 3600;

async function ensureRollups(): Promise<void> {
  const rollups = nativeDb().collection(TELEMETRY_1M);
  await rollups.createIndex({ satId: 1, bucket: 1 }, { unique: true });
  // Heatmaps scan every satellite over a bucket range, so they need the time-leading index (also the TTL).
  await rollups.createIndex({ bucket: 1 }, { expireAfterSeconds: ROLLUP_TTL_SECONDS });
}

/** Creates the time-series + rollup collections and builds every Mongoose model's indexes. */
export async function ensureCollections(options: CollectionOptions): Promise<void> {
  await ensureTelemetry(Math.round(options.rawTtlHours * 3600));
  await ensureRollups();
  await Promise.all(Object.values(models).map((m) => m.init()));
}
