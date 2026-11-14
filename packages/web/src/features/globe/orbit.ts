// Client-side orbit propagation from catalogue TLEs (satellite.js / SGP4). The globe and the station views use it
// to place satellites at any instant without waiting for telemetry, which also makes replay positions free.
import {
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  propagate,
  radiansToDegrees,
  twoline2satrec,
  SatRecError,
  type SatRec,
} from 'satellite.js';
import type { Satellite } from '../../api/types.ts';
import { wrapLon, type LonLat } from './antimeridian.ts';

export interface Geodetic {
  lon: number;
  lat: number;
  altKm: number;
}

export interface SatPosition extends Geodetic {
  satId: number;
}

export interface Observer {
  lat: number;
  lon: number;
  altKm: number;
}

/** Sub-satellite point and altitude, or null when SGP4 cannot propagate to this instant. */
export function geodeticAt(satrec: SatRec, date: Date): Geodetic | null {
  const state = propagate(satrec, date);
  if (!state) return null;
  const g = eciToGeodetic(state.position, gstime(date));
  return {
    lon: wrapLon(radiansToDegrees(g.longitude)),
    lat: radiansToDegrees(g.latitude),
    altKm: g.height,
  };
}

/** Elevation of the satellite above the observer's horizon in degrees, or null if it cannot be propagated. */
export function elevationAt(satrec: SatRec, observer: Observer, date: Date): number | null {
  const state = propagate(satrec, date);
  if (!state) return null;
  const ecf = eciToEcf(state.position, gstime(date));
  const site = {
    latitude: degreesToRadians(observer.lat),
    longitude: degreesToRadians(observer.lon),
    height: observer.altKm,
  };
  return radiansToDegrees(ecfToLookAngles(site, ecf).elevation);
}

/** Ground track samples (lon/lat) from `fromMs` to `toMs`, one per `stepMs`. Unpropagatable instants are skipped. */
export function groundTrack(
  satrec: SatRec,
  fromMs: number,
  toMs: number,
  stepMs: number,
): LonLat[] {
  const points: LonLat[] = [];
  for (let ms = fromMs; ms <= toMs; ms += stepMs) {
    const g = geodeticAt(satrec, new Date(ms));
    if (g) points.push([g.lon, g.lat]);
  }
  return points;
}

/** Parsed TLEs for the whole catalogue, rebuilt only when the catalogue object changes. */
export class FleetPropagator {
  private satrecs = new Map<number, SatRec>();
  private source: Record<number, Satellite> | null = null;

  sync(catalog: Record<number, Satellite>): void {
    if (catalog === this.source) return;
    this.source = catalog;
    this.satrecs = new Map();
    for (const sat of Object.values(catalog)) {
      const satrec = twoline2satrec(sat.line1, sat.line2);
      if (satrec.error === SatRecError.None) this.satrecs.set(sat.satId, satrec);
    }
  }

  satrec(satId: number): SatRec | undefined {
    return this.satrecs.get(satId);
  }

  allSatrecs(): IterableIterator<SatRec> {
    return this.satrecs.values();
  }

  /** Positions of every propagatable satellite at `ms`. */
  positionsAt(ms: number): SatPosition[] {
    const date = new Date(ms);
    const out: SatPosition[] = [];
    for (const [satId, satrec] of this.satrecs) {
      const g = geodeticAt(satrec, date);
      if (g) out.push({ satId, ...g });
    }
    return out;
  }
}

export interface VisibilitySite extends Observer {
  id: string;
  minElevDeg: number;
}

/** Number of satellites above each station's minimum elevation at `ms` (stations with none map to 0). */
export function visibleCounts(
  satrecs: Iterable<SatRec>,
  stations: readonly VisibilitySite[],
  ms: number,
): Map<string, number> {
  const counts = new Map(stations.map((st) => [st.id, 0]));
  const date = new Date(ms);
  for (const satrec of satrecs) {
    for (const st of stations) {
      const elevation = elevationAt(satrec, st, date);
      if (elevation !== null && elevation >= st.minElevDeg)
        counts.set(st.id, (counts.get(st.id) ?? 0) + 1);
    }
  }
  return counts;
}
