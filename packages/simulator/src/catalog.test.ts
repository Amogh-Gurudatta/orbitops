import { describe, expect, it } from 'vitest';
import {
  loadGroundStations,
  loadSatelliteSnapshot,
  parseTle,
  refreshTles,
  selectSatellites,
} from './catalog.js';

const sats = loadSatelliteSnapshot();

describe('catalog', () => {
  it('loads the bundled snapshot and stations', () => {
    expect(sats.length).toBe(64);
    expect(loadGroundStations().length).toBeGreaterThan(5);
  });

  it('shards disjointly and completely, and SIM_SATS narrows first', () => {
    const shards = [0, 1, 2].map((index) => selectSatellites(sats, [], { index, count: 3 }));
    expect(shards.flat().length).toBe(sats.length);
    expect(new Set(shards.flat().map((s) => s.noradId)).size).toBe(sats.length);
    expect(
      selectSatellites(sats, [25544, 48274], { index: 0, count: 1 }).map((s) => s.noradId),
    ).toEqual([25544, 48274]);
    expect(
      selectSatellites(sats, [25544, 48274], { index: 1, count: 2 }).map((s) => s.noradId),
    ).toEqual([48274]);
  });

  it('parses a CelesTrak TLE response and rejects mismatched ids', () => {
    const iss = sats[0]!;
    const body = `${iss.name}\r\n${iss.line1}\r\n${iss.line2}\r\n`;
    expect(parseTle(body, iss.noradId)).toEqual({ line1: iss.line1, line2: iss.line2 });
    expect(parseTle(body, 1)).toBeNull();
    expect(parseTle('No GP data found', iss.noradId)).toBeNull();
  });

  it('refresh updates TLEs, and aborts quietly on the first failure', async () => {
    const [a, b, c] = sats as [(typeof sats)[0], (typeof sats)[0], (typeof sats)[0]];
    let calls = 0;
    const fetchImpl = async (url: string) => {
      calls++;
      if (calls === 2) throw new Error('offline');
      const id = Number(new URL(url).searchParams.get('CATNR'));
      const sat = sats.find((s) => s.noradId === id)!;
      return { ok: true, text: async () => `X\n${sat.line1}\n${sat.line2}\n` };
    };
    const result = await refreshTles([a, b, c], fetchImpl, 0);
    expect(calls).toBe(2);
    expect(result.refreshed).toBe(1);
    expect(result.satellites).toEqual([a, b, c]);
  });
});
