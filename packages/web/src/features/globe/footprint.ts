// Ground-station visibility footprints on an H3 grid. A satellite at altitude h is above a station's minimum
// elevation e while its sub-satellite point lies within a spherical cap of angular radius
//   lambda = acos(Re * cos(e) / (Re + h)) - e
// around the station. Coverage = how many stations' caps contain each H3 cell centre.
import {
  cellToLatLng,
  getHexagonEdgeLengthAvg,
  gridDisk,
  greatCircleDistance,
  latLngToCell,
} from 'h3-js';

const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

/** Reference orbit for the footprint: a typical 550 km LEO. */
export const REFERENCE_ALTITUDE_KM = 550;
/** H3 resolution of the coverage grid (cell edge ~69 km, a few hundred cells per footprint). */
export const COVERAGE_RESOLUTION = 3;

export interface StationSite {
  id: string;
  lat: number;
  lon: number;
  minElevDeg: number;
}

/** Angular radius (degrees of arc) of the visibility cap for a satellite at `altKm` seen above `minElevDeg`. */
export function footprintAngularRadiusDeg(altKm: number, minElevDeg: number): number {
  const e = minElevDeg * DEG;
  const ratio = (EARTH_RADIUS_KM * Math.cos(e)) / (EARTH_RADIUS_KM + altKm);
  return (Math.acos(ratio) - e) / DEG;
}

/** Ground distance (km) of the visibility cap radius. */
export function footprintRadiusKm(altKm: number, minElevDeg: number): number {
  return footprintAngularRadiusDeg(altKm, minElevDeg) * DEG * EARTH_RADIUS_KM;
}

export interface CoverageCell {
  cell: string;
  /** Number of stations whose footprint covers the cell. */
  count: number;
}

/** H3 cells inside one station's footprint. */
export function stationCells(
  station: StationSite,
  altKm = REFERENCE_ALTITUDE_KM,
  resolution = COVERAGE_RESOLUTION,
): string[] {
  const radiusKm = footprintRadiusKm(altKm, station.minElevDeg);
  // Neighbouring cell centres are ~sqrt(3) edge lengths apart; one extra ring covers the boundary cells.
  const spacingKm = Math.sqrt(3) * getHexagonEdgeLengthAvg(resolution, 'km');
  const rings = Math.ceil(radiusKm / spacingKm) + 1;
  const centre = latLngToCell(station.lat, station.lon, resolution);
  return gridDisk(centre, rings).filter((cell) => {
    const [lat, lon] = cellToLatLng(cell);
    return greatCircleDistance([station.lat, station.lon], [lat, lon], 'km') <= radiusKm;
  });
}

/** Coverage counts for a set of stations (cells covered by at least one station). */
export function coverageCells(
  stations: readonly StationSite[],
  altKm = REFERENCE_ALTITUDE_KM,
  resolution = COVERAGE_RESOLUTION,
): CoverageCell[] {
  const counts = new Map<string, number>();
  for (const station of stations) {
    for (const cell of stationCells(station, altKm, resolution)) {
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
  }
  return [...counts].map(([cell, count]) => ({ cell, count }));
}
