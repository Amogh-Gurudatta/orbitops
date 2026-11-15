// One SatelliteAgent per satellite: orbit + spacecraft model + sequence numbers -> TelemetryEvents.
import { sourceIdFromSatId, type Command, type TelemetryEvent } from '@orbitops/shared';
import { FaultState } from './faults.js';
import { bestVisibleStation, Orbit, shadowAt, type GroundStation } from './orbit.js';
import { Spacecraft } from './physics.js';

export interface SatelliteDefinition {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
}

/**
 * Maps wall-clock time to simulated time. With SIM_TIME_SCALE > 1 the orbit and physics run faster
 * than real time, but event timestamps stay on the wall clock so the server's timestamp window holds.
 */
export class SimClock {
  private readonly wallStartMs: number;
  private readonly simStartMs: number;

  constructor(
    private readonly timeScale: number,
    startMs: number = Date.now(),
  ) {
    this.wallStartMs = startMs;
    this.simStartMs = startMs;
  }

  simTimeAt(wallMs: number): number {
    return this.simStartMs + (wallMs - this.wallStartMs) * this.timeScale;
  }
}

/** Largest physics step, as a multiple of the nominal sample interval (see sample()). */
const MAX_STEP_MULTIPLE = 10;

export class SatelliteAgent {
  readonly noradId: number;
  readonly name: string;
  readonly sourceId: string;
  readonly faults = new FaultState();
  private readonly orbit: Orbit;
  private readonly spacecraft: Spacecraft;
  private seq: number;
  private lastSimMs: number | null = null;

  /**
   * `startMs` seeds the first seq as floor(startMs / 100). The server keeps a per-source seq
   * high-watermark that survives restarts, so a restarted simulator must not reuse low numbers. The
   * seed grows at 10/s while seq advances at most SIM_HZ (<= 10) per second, so a later boot always
   * starts above anything an earlier process sent.
   */
  constructor(
    satellite: SatelliteDefinition,
    private readonly stations: readonly GroundStation[],
    private readonly clock: SimClock,
    private readonly nominalDtS: number,
    startMs: number = Date.now(),
  ) {
    this.noradId = satellite.noradId;
    this.name = satellite.name;
    this.sourceId = sourceIdFromSatId(satellite.noradId);
    this.orbit = new Orbit(satellite.line1, satellite.line2);
    this.spacecraft = new Spacecraft(satellite.noradId, this.faults);
    this.seq = Math.floor(startMs / 100);
  }

  /** One telemetry sample for the given wall-clock instant, or null if SGP4 cannot propagate. */
  sample(wallMs: number): TelemetryEvent | null {
    const simMs = this.clock.simTimeAt(wallMs);
    const simDate = new Date(simMs);
    const orbit = this.orbit.propagateAt(simDate);
    if (orbit === null) return null;

    // Cap the integration step: after a host suspend or a long event-loop stall the wall-clock gap can
    // be hours, and integrating it in one step would slam every battery to 0 % (eclipse) or 100 % (sun).
    const rawDtS = this.lastSimMs === null ? this.nominalDtS : (simMs - this.lastSimMs) / 1000;
    const dtS = Math.min(rawDtS, this.nominalDtS * MAX_STEP_MULTIPLE);
    this.lastSimMs = simMs;

    const data = this.spacecraft.step({
      dtS: Math.max(0, dtS),
      simTimeMs: simMs,
      orbit,
      shadow: shadowAt(simDate, orbit.eciPos),
      link: bestVisibleStation(this.stations, orbit.ecfPos),
    });
    return { seq: this.seq++, ts: Math.round(wallMs), type: 'tm', data };
  }

  handleCommand(command: Command): void {
    if (command.satId === this.noradId) this.faults.apply(command);
  }
}
