// Path helpers for lon/lat polylines drawn on the globe: splitting at the antimeridian (a segment from lon 179 to
// -179 would otherwise streak across the whole map) and cutting a path into dashes (no path-style extension needed).

export type LonLat = readonly [lon: number, lat: number];

/** Wraps a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Splits a polyline wherever consecutive points jump across the antimeridian. Each side gets an interpolated
 * point on the +/-180 line so the pieces meet the seam without a visible gap.
 */
export function splitAtAntimeridian(points: readonly LonLat[]): LonLat[][] {
  const segments: LonLat[][] = [];
  let current: LonLat[] = [];
  for (const point of points) {
    const previous = current[current.length - 1];
    if (previous && Math.abs(point[0] - previous[0]) > 180) {
      const exitLon = previous[0] > 0 ? 180 : -180;
      // Unwrap the new longitude onto the previous side to interpolate where the seam is crossed.
      const unwrapped = point[0] + (previous[0] > 0 ? 360 : -360);
      const t = (exitLon - previous[0]) / (unwrapped - previous[0]);
      const lat = previous[1] + t * (point[1] - previous[1]);
      current.push([exitLon, lat]);
      segments.push(current);
      current = [[-exitLon, lat]];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments.filter((segment) => segment.length > 1);
}

/**
 * Cuts a polyline into dashes: `on` consecutive points are kept, then `off` points are skipped. Samples are
 * evenly spaced in time, so the dash length is uniform along the orbit. Adjacent dashes share no points.
 */
export function dashPath(points: readonly LonLat[], on: number, off: number): LonLat[][] {
  const dashes: LonLat[][] = [];
  const period = on + off;
  for (let start = 0; start < points.length; start += period) {
    // One extra point so the dash reaches the next sample instead of leaving a stub.
    const dash = points.slice(start, start + on + 1);
    if (dash.length > 1) dashes.push([...dash]);
  }
  return dashes;
}
