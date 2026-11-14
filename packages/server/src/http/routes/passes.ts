// /passes: upcoming visibility windows of a satellite over ground stations. Propagation is CPU heavy, so
// results are cached per (satellite, station, hour bucket, horizon); every request within the same hour
// reuses them and only filters to the caller's "now".
import { setImmediate } from 'node:timers/promises';
import { Router } from 'express';
import { LRUCache } from 'lru-cache';
import { z } from 'zod';
import { computePasses, type Pass, type StationSite, type TleSource } from '../../orbit/passes.js';
import { GroundStation, Satellite } from '../../models/index.js';
import { HttpError } from '../errors.js';
import { intQuery, SatIdParam } from '../params.js';

const MAX_HOURS = 48;
const HOUR_MS = 3_600_000;

const PassQuery = z.strictObject({
  satId: SatIdParam,
  stationId: z.string().min(1).max(64).optional(),
  hours: intQuery(1, MAX_HOURS, 12),
});

interface PassWire extends Pass {
  satId: number;
  stationId: string;
}

export function createPassesRouter(): Router {
  const router = Router();
  const cache = new LRUCache<string, Pass[]>({ max: 2000, ttl: 2 * HOUR_MS });

  /** Computed from the start of the current hour, with an hour of slack, so it stays valid all hour. */
  function cachedPasses(
    satId: number,
    tle: TleSource,
    station: StationSite & { id: string },
    hourStart: number,
    hours: number,
  ): Pass[] {
    const key = `${satId}:${station.id}:${hourStart}:${hours}`;
    let passes = cache.get(key);
    if (!passes) {
      passes = computePasses(tle, station, hourStart, hours + 1);
      cache.set(key, passes);
    }
    return passes;
  }

  router.get('/', async (req, res) => {
    const { satId, stationId, hours } = PassQuery.parse(req.query);
    const [satellite, stations] = await Promise.all([
      Satellite.findOne({ satId }, { line1: 1, line2: 1 }).lean(),
      GroundStation.find(stationId ? { id: stationId } : {}, { _id: 0, loc: 0 })
        .sort({ id: 1 })
        .lean(),
    ]);
    if (!satellite) throw new HttpError(404, 'satellite_not_found');
    if (stationId && stations.length === 0) throw new HttpError(404, 'station_not_found');

    const now = Date.now();
    const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
    const horizon = now + hours * HOUR_MS;
    const passes: PassWire[] = [];
    for (const station of stations) {
      for (const pass of cachedPasses(satId, satellite, station, hourStart, hours)) {
        if (pass.los > now && pass.aos < horizon) {
          passes.push({
            satId,
            stationId: station.id,
            aos: pass.aos,
            los: pass.los,
            maxElevDeg: Math.round(pass.maxElevDeg * 10) / 10,
          });
        }
      }
      // A cold all-stations request is a few thousand propagations per station: let ingest breathe between them.
      await setImmediate();
    }
    passes.sort((a, b) => a.aos - b.aos);
    res.json({ passes });
  });

  return router;
}
