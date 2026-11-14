// Thin wrapper over satellite.js (SGP4): position/velocity, Earth shadow and look angles to a station.
import {
  degreesLat,
  degreesLong,
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  jday,
  propagate,
  radiansToDegrees,
  shadowFraction,
  sunPos,
  twoline2satrec,
  type EciVec3,
  type EcfVec3,
  type Kilometer,
  type SatRec,
} from 'satellite.js';

export interface OrbitState {
  lat: number;
  lon: number;
  altKm: number;
  /** Inertial speed, km/s. */
  velKms: number;
  eciPos: EciVec3<Kilometer>;
  ecfPos: EcfVec3<Kilometer>;
  gmst: number;
}

export interface StationSite {
  lat: number;
  lon: number;
  altKm: number;
}

export interface LookAngle {
  elevDeg: number;
  rangeKm: number;
}

export class Orbit {
  private readonly satrec: SatRec;

  constructor(line1: string, line2: string) {
    this.satrec = twoline2satrec(line1, line2);
  }

  /** null when SGP4 fails (decayed satellite, stale elements, invalid TLE). */
  propagateAt(date: Date): OrbitState | null {
    const pv = propagate(this.satrec, date);
    if (pv === null) return null;
    const { position, velocity } = pv;
    const gmst = gstime(date);
    const geodetic = eciToGeodetic(position, gmst);
    const velKms = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (![geodetic.latitude, geodetic.longitude, geodetic.height, velKms].every(Number.isFinite)) {
      return null;
    }
    return {
      lat: degreesLat(geodetic.latitude),
      lon: degreesLong(geodetic.longitude),
      altKm: Math.max(0, geodetic.height),
      velKms,
      eciPos: position,
      ecfPos: eciToEcf(position, gmst),
      gmst,
    };
  }
}

/**
 * Fraction of the solar disc hidden by Earth (0 sunlit .. 1 umbra), using satellite.js's
 * `shadowFraction` (a conical umbra + penumbra model) with `sunPos` at the given instant.
 */
export function shadowAt(date: Date, eciPos: EciVec3<Kilometer>): number {
  const { rsun } = sunPos(jday(date));
  return shadowFraction(rsun, eciPos);
}

export function lookAngles(station: StationSite, satEcf: EcfVec3<Kilometer>): LookAngle {
  const look = ecfToLookAngles(
    {
      latitude: degreesToRadians(station.lat),
      longitude: degreesToRadians(station.lon),
      height: station.altKm,
    },
    satEcf,
  );
  return { elevDeg: radiansToDegrees(look.elevation), rangeKm: look.rangeSat };
}

export interface GroundStation extends StationSite {
  id: string;
  minElevDeg: number;
}

export interface VisibleStation {
  stationId: string;
  elevDeg: number;
  rangeKm: number;
}

/** Highest-elevation station that is above its own minimum elevation, or null. */
export function bestVisibleStation(
  stations: readonly GroundStation[],
  satEcf: EcfVec3<Kilometer>,
): VisibleStation | null {
  let best: VisibleStation | null = null;
  for (const station of stations) {
    const { elevDeg, rangeKm } = lookAngles(station, satEcf);
    if (elevDeg >= station.minElevDeg && (best === null || elevDeg > best.elevDeg)) {
      best = { stationId: station.id, elevDeg, rangeKm };
    }
  }
  return best;
}
