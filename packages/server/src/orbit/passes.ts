// Satellite pass prediction: when does a TLE-propagated satellite rise above a ground station's minimum
// elevation? The window is stepped coarsely (30 s, far shorter than any pass), then each AOS/LOS crossing is
// refined by bisection to about one second and the peak elevation by ternary search.
import {
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  gstime,
  propagate,
  radiansToDegrees,
  twoline2satrec,
  type GeodeticLocation,
  type SatRec,
} from 'satellite.js';

export interface TleSource {
  line1: string;
  line2: string;
}

export interface StationSite {
  lat: number;
  lon: number;
  altKm: number;
  minElevDeg: number;
}

/** Times are epoch milliseconds. */
export interface Pass {
  aos: number;
  los: number;
  maxElevDeg: number;
}

const STEP_MS = 30_000;
const REFINE_TOLERANCE_MS = 1000;
const MAX_TRACE_MS = 24 * 3_600_000;

/** Elevation (degrees) of the satellite above the site's horizon, or null when SGP4 cannot propagate. */
function elevationDeg(satrec: SatRec, site: GeodeticLocation, atMs: number): number | null {
  const date = new Date(atMs);
  const state = propagate(satrec, date);
  if (!state) return null;
  const ecf = eciToEcf(state.position, gstime(date));
  return radiansToDegrees(ecfToLookAngles(site, ecf).elevation);
}

/**
 * Narrows the boundary between a hidden and a visible instant (either order) to ~1 s and returns the
 * visible side: the first visible instant for an AOS, the last visible one for a LOS.
 */
function bisectBoundary(
  isVisible: (ms: number) => boolean,
  hiddenMs: number,
  visibleMs: number,
): number {
  let hidden = hiddenMs;
  let visible = visibleMs;
  while (Math.abs(visible - hidden) > REFINE_TOLERANCE_MS) {
    const mid = Math.round((hidden + visible) / 2);
    if (isVisible(mid)) visible = mid;
    else hidden = mid;
  }
  return visible;
}

/** The start of the visible interval containing `visibleMs`, found by stepping back until it is hidden. */
function traceBackToAos(isVisible: (ms: number) => boolean, visibleMs: number): number {
  let visible = visibleMs;
  for (let ms = visibleMs - STEP_MS; ms > visibleMs - MAX_TRACE_MS; ms -= STEP_MS) {
    if (!isVisible(ms)) return bisectBoundary(isVisible, ms, visible);
    visible = ms;
  }
  return visible;
}

/** Peak elevation between two instants (a pass has a single maximum, so ternary search converges). */
function peakElevation(
  elevationAt: (ms: number) => number,
  startMs: number,
  endMs: number,
): number {
  let low = startMs;
  let high = endMs;
  while (high - low > REFINE_TOLERANCE_MS) {
    const third = (high - low) / 3;
    if (elevationAt(low + third) < elevationAt(high - third)) low += third;
    else high -= third;
  }
  return elevationAt((low + high) / 2);
}

/**
 * Passes whose visible interval overlaps [fromMs, fromMs + hours]. AOS/LOS are always the true crossings:
 * a pass already in progress at the start is traced backwards, and one still running at the end forwards
 * (both bounded by MAX_TRACE_MS, which only matters for near-stationary geostationary targets).
 */
export function computePasses(
  tle: TleSource,
  station: StationSite,
  fromMs: number,
  hours: number,
): Pass[] {
  const satrec = twoline2satrec(tle.line1, tle.line2);
  const site: GeodeticLocation = {
    latitude: degreesToRadians(station.lat),
    longitude: degreesToRadians(station.lon),
    height: station.altKm,
  };
  // Samples where SGP4 fails count as far below the horizon so they close any open pass.
  const elevationAt = (ms: number): number => elevationDeg(satrec, site, ms) ?? -90;
  const isVisible = (ms: number): boolean => elevationAt(ms) >= station.minElevDeg;
  const endMs = fromMs + hours * 3_600_000;

  const passes: Pass[] = [];
  let aos: number | null = isVisible(fromMs) ? traceBackToAos(isVisible, fromMs) : null;
  let previousMs = fromMs;
  let previousVisible = aos !== null;

  for (let ms = fromMs + STEP_MS; ; ms += STEP_MS) {
    const visible = isVisible(ms);
    if (visible && !previousVisible) {
      aos = bisectBoundary(isVisible, previousMs, ms);
    } else if (!visible && previousVisible && aos !== null) {
      const los = bisectBoundary(isVisible, ms, previousMs);
      passes.push({ aos, los, maxElevDeg: peakElevation(elevationAt, aos, los) });
      aos = null;
    }
    previousMs = ms;
    previousVisible = visible;
    // Past the window end, keep going only to close a pass that is still open.
    if (ms >= endMs && !visible) break;
    if (ms >= endMs + MAX_TRACE_MS) break;
  }
  return passes;
}
