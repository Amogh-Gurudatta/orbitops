import { TelemetryEvent, TelemetryFrame } from '@orbitops/shared';
import { describe, expect, it } from 'vitest';
import { SatelliteAgent, SimClock } from './agent.js';
import { loadGroundStations, loadSatelliteSnapshot } from './catalog.js';
import { Orbit } from './orbit.js';

const STATIONS = loadGroundStations();
const START = Date.parse('2026-11-14T00:00:00Z');
const SATS = loadSatelliteSnapshot()
  .filter((s) => new Orbit(s.line1, s.line2).propagateAt(new Date(START)) !== null)
  .slice(0, 5);

function makeAgent(index: number, startMs = START): SatelliteAgent {
  return new SatelliteAgent(SATS[index]!, STATIONS, new SimClock(1, startMs), 1, startMs);
}

/** Runs an agent at 1 Hz of simulated (= wall) time and returns every produced frame. */
function run(agent: SatelliteAgent, fromSec: number, seconds: number): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  for (let i = 0; i < seconds; i++) {
    const event = agent.sample(START + (fromSec + i) * 1000);
    expect(event).not.toBeNull();
    frames.push(event!.data);
  }
  return frames;
}

describe('SatelliteAgent', () => {
  it('emits schema-valid events with increasing seq over 2 hours at 1 Hz for 5 satellites', () => {
    SATS.forEach((_, index) => {
      const agent = makeAgent(index);
      let lastSeq = -1;
      for (let i = 0; i < 7200; i++) {
        const event = agent.sample(START + i * 1000)!;
        const parsed = TelemetryEvent.safeParse(event);
        expect(parsed.success, `${agent.name} t=${i}`).toBe(true);
        expect(event.seq).toBeGreaterThan(lastSeq);
        expect(event.ts).toBe(START + i * 1000);
        lastSeq = event.seq;
      }
    });
  });

  it('starts seq from a clock-based value so restarts never reuse persisted seqs', () => {
    const early = makeAgent(0, START).sample(START)!;
    const later = makeAgent(0, START + 60_000).sample(START + 60_000)!;
    expect(early.seq).toBe(Math.floor(START / 100));
    expect(later.seq).toBeGreaterThan(early.seq + 500);
  });

  it('battery drains in eclipse and recharges in sunlight', () => {
    const frames = run(makeAgent(0), 0, 6000);
    let eclipseDrop = 0;
    let sunGain = 0;
    for (let i = 1; i < frames.length; i++) {
      const delta = frames[i]!.batSoc - frames[i - 1]!.batSoc;
      if (frames[i]!.shadow > 0.99) eclipseDrop += delta;
      else if (frames[i]!.shadow < 0.01 && frames[i]!.batSoc < 0.99) sunGain += delta;
    }
    expect(eclipseDrop).toBeLessThan(-0.05);
    expect(sunGain).toBeGreaterThan(0.05);
    expect(frames.some((f) => f.mode === 'ECLIPSE')).toBe(true);
    expect(frames.some((f) => f.mode === 'NOMINAL')).toBe(true);
    expect(
      frames.some((f) => f.stationId !== null && f.rssiDbm! >= -120 && f.rssiDbm! <= -90),
    ).toBe(true);
  });

  it('a battery fault drives SoC below 0.2 within 20 s and clear_fault stops the drain', () => {
    const agent = makeAgent(1);
    run(agent, 0, 30);
    agent.handleCommand({ satId: agent.noradId, kind: 'inject_fault', fault: 'battery' });
    const faulty = run(agent, 30, 20);
    expect(faulty[faulty.length - 1]!.batSoc).toBeLessThan(0.2);
    expect(faulty[faulty.length - 1]!.mode).toBe('DEGRADED');
    agent.handleCommand({ satId: agent.noradId, kind: 'clear_fault', fault: 'battery' });
    const after = run(agent, 50, 30);
    expect(after[after.length - 1]!.batSoc).toBeGreaterThanOrEqual(after[0]!.batSoc - 0.01);
  });

  it('a thermal fault pushes the panel past 85 C within 20 s and recovers after clearing', () => {
    const agent = makeAgent(2);
    run(agent, 0, 30);
    agent.handleCommand({ satId: agent.noradId, kind: 'inject_fault', fault: 'thermal' });
    const hot = run(agent, 30, 20);
    expect(Math.max(...hot.map((f) => f.panelTempC))).toBeGreaterThan(85);
    agent.handleCommand({ satId: agent.noradId, kind: 'clear_fault' });
    const cooled = run(agent, 50, 120);
    expect(cooled[cooled.length - 1]!.panelTempC).toBeLessThan(80);
  });

  it('a tumble raises the attitude rate to 3-8 dps and makes solar power oscillate', () => {
    const agent = makeAgent(3);
    run(agent, 0, 10);
    agent.handleCommand({ satId: agent.noradId, kind: 'inject_fault', fault: 'tumble' });
    const frames = run(agent, 10, 30).filter((f) => f.shadow < 0.01);
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) {
      expect(f.attRateDps).toBeGreaterThan(2.5);
      expect(f.attRateDps).toBeLessThan(9);
    }
    const solar = frames.map((f) => f.solarW);
    expect(Math.max(...solar) / Math.max(1, Math.min(...solar))).toBeGreaterThan(1.5);
  });

  it('a comms fault drops the carrier while the station stays in view', () => {
    const agent = makeAgent(0);
    let t = 0;
    while (agent.sample(START + t * 1000)!.data.stationId === null) t += 30;
    agent.handleCommand({ satId: agent.noradId, kind: 'inject_fault', fault: 'comms' });
    const frame = agent.sample(START + (t + 1) * 1000)!.data;
    expect(frame).toMatchObject({ rssiDbm: null, snrDb: null, mode: 'LOS' });
    expect(frame.stationId).not.toBeNull();
    expect(frame.elevDeg).not.toBeNull();
    agent.handleCommand({ satId: agent.noradId, kind: 'clear_fault', fault: 'comms' });
    expect(agent.sample(START + (t + 2) * 1000)!.data.mode).not.toBe('LOS');
  });

  it('safe mode sheds load and nominal_mode restores it; other satellites are ignored', () => {
    const agent = makeAgent(4);
    const meanBusA = (frames: TelemetryFrame[]): number =>
      frames.reduce((sum, f) => sum + f.busA, 0) / frames.length;
    const before = meanBusA(run(agent, 0, 200));
    agent.handleCommand({ satId: agent.noradId + 1, kind: 'safe_mode' });
    expect(run(agent, 200, 1)[0]!.mode).not.toBe('SAFE');
    agent.handleCommand({ satId: agent.noradId, kind: 'safe_mode' });
    const safeFrames = run(agent, 201, 200);
    expect(safeFrames.every((f) => f.mode === 'SAFE')).toBe(true);
    expect(meanBusA(safeFrames)).toBeLessThan(before * 0.8);
    agent.handleCommand({ satId: agent.noradId, kind: 'nominal_mode' });
    expect(run(agent, 401, 1)[0]!.mode).not.toBe('SAFE');
  });

  it('is deterministic per satellite for the same inputs', () => {
    const a = run(makeAgent(0), 0, 50);
    const b = run(makeAgent(0), 0, 50);
    expect(a).toEqual(b);
  });
});
