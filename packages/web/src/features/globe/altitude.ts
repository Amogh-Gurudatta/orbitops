// Visual altitude scale for the globe. Real LEO altitudes (400-800 km) are ~6-12% of Earth's radius and read as
// "hugging the surface"; GEO (35 786 km) would sit 5.6 radii away. A logarithmic compression lifts LEO clearly off
// the surface (about 1.6x real) while keeping GEO within about 0.6 radii, so every orbit shell stays on screen.

/** Earth radius used by deck.gl's GlobeView, in metres. */
export const EARTH_RADIUS_M = 6_370_972;

/** Altitude (km) at which the log curve starts to bend; controls how much LEO is exaggerated. */
const KNEE_KM = 300;
/** Visual height in Earth radii per natural-log unit. */
const RADII_PER_LOG_UNIT = 0.12;

/** Maps a real altitude in km to the metres-above-surface value used to place a marker on the globe. */
export function visualAltitudeM(altKm: number): number {
  if (!Number.isFinite(altKm) || altKm <= 0) return 0;
  return EARTH_RADIUS_M * RADII_PER_LOG_UNIT * Math.log1p(altKm / KNEE_KM);
}
