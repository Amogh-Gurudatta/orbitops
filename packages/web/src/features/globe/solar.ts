// Sun position and the day/night terminator. The sub-solar point comes from satellite.js's low-precision solar
// ephemeris (right ascension/declination) and the sidereal time at the instant.
import { gstime, jday, sunPos } from 'satellite.js';
import { wrapLon, type LonLat } from './antimeridian.ts';

const DEG = 180 / Math.PI;

/** Point on Earth where the Sun is at the zenith. */
export function subsolarPoint(ms: number): { lat: number; lon: number } {
  const date = new Date(ms);
  const { rtasc, decl } = sunPos(jday(date));
  return { lat: decl * DEG, lon: wrapLon((rtasc - gstime(date)) * DEG) };
}

/**
 * Closed ring (lon/lat) covering the night hemisphere. The terminator is the great circle 90 degrees from the
 * sub-solar point: lat(lon) = atan(-cos(lon - lonSun) / tan(declination)). The ring is closed through the pole
 * that is currently in darkness (the one opposite the Sun's declination).
 */
export function nightPolygon(ms: number, stepDeg = 2): LonLat[] {
  const { lat: sunLat, lon: sunLon } = subsolarPoint(ms);
  // Avoid tan(0) at the equinoxes; the result is continuous so the nudge is invisible.
  const tanDecl =
    Math.tan(Math.max(Math.abs(sunLat), 1e-4) * (Math.PI / 180)) * Math.sign(sunLat || 1);
  const ring: LonLat[] = [];
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const lat = Math.atan(-Math.cos((lon - sunLon) / DEG) / tanDecl) * DEG;
    ring.push([lon, lat]);
  }
  const darkPoleLat = sunLat >= 0 ? -90 : 90;
  ring.push([180, darkPoleLat], [-180, darkPoleLat]);
  return ring;
}
