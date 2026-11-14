// Satellite and ground-station catalog: the bundled snapshot in data/, an optional one-shot live TLE
// refresh from CelesTrak, and the SIM_SATS / SIM_SHARD selection.
import { readFileSync } from 'node:fs';
import type { SatelliteDefinition } from './agent.js';
import type { Shard } from './config.js';
import type { GroundStation } from './orbit.js';

const DATA_DIR = new URL('../../../data/', import.meta.url);
const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const FETCH_TIMEOUT_MS = 5_000;
/** Pause between CelesTrak requests; the service asks automated clients to go easy on it. */
const POLITE_DELAY_MS = 300;

export function loadSatelliteSnapshot(): SatelliteDefinition[] {
  const file = JSON.parse(readFileSync(new URL('satellites.json', DATA_DIR), 'utf8')) as {
    satellites: SatelliteDefinition[];
  };
  return file.satellites.map(({ noradId, name, line1, line2 }) => ({
    noradId,
    name,
    line1,
    line2,
  }));
}

export function loadGroundStations(): GroundStation[] {
  const file = JSON.parse(readFileSync(new URL('ground-stations.json', DATA_DIR), 'utf8')) as {
    stations: GroundStation[];
  };
  return file.stations;
}

/** SIM_SATS first (empty = all), then the shard filter by position in that list. */
export function selectSatellites(
  all: readonly SatelliteDefinition[],
  satIds: readonly number[],
  shard: Shard,
): SatelliteDefinition[] {
  const wanted = satIds.length > 0 ? all.filter((s) => satIds.includes(s.noradId)) : [...all];
  return wanted.filter((_, i) => i % shard.count === shard.index);
}

/** Extracts the two element lines for `noradId` from a CelesTrak TLE response (name line optional). */
export function parseTle(body: string, noradId: number): { line1: string; line2: string } | null {
  const lines = body.split(/\r?\n/).map((l) => l.trimEnd());
  const line1 = lines.find((l) => l.startsWith('1 '));
  const line2 = lines.find((l) => l.startsWith('2 '));
  if (!line1 || !line2 || line1.length < 69 || line2.length < 69) return null;
  if (Number(line1.slice(2, 7)) !== noradId || Number(line2.slice(2, 7)) !== noradId) return null;
  return { line1, line2 };
}

type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Tries to replace each satellite's TLE with the live CelesTrak one. Requests are sequential and
 * spaced out; the first failure (network, timeout, HTTP error) aborts the whole refresh and the
 * remaining satellites keep their snapshot elements. Never throws.
 */
export async function refreshTles(
  satellites: readonly SatelliteDefinition[],
  fetchImpl: FetchLike = fetch,
  delayMs: number = POLITE_DELAY_MS,
): Promise<{ satellites: SatelliteDefinition[]; refreshed: number }> {
  const result: SatelliteDefinition[] = [];
  let refreshed = 0;
  let aborted = false;
  for (const sat of satellites) {
    if (aborted) {
      result.push(sat);
      continue;
    }
    try {
      const url = `${CELESTRAK_URL}?CATNR=${sat.noradId}&FORMAT=TLE`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error('http error');
      const tle = parseTle(await res.text(), sat.noradId);
      if (tle) {
        result.push({ ...sat, ...tle });
        refreshed++;
      } else {
        result.push(sat);
      }
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch {
      aborted = true;
      result.push(sat);
    }
  }
  return { satellites: result, refreshed };
}
