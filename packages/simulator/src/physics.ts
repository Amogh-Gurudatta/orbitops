// A small, believable spacecraft model: power (solar, battery), thermal, comms link, attitude, propellant.
// Per-satellite parameters are derived deterministically from the NORAD id so every run looks the same.
import type { TelemetryFrame } from '@orbitops/shared';
import {
  BATTERY_FAULT_DRAIN_PER_S,
  SAFE_MODE_LOAD_FACTOR,
  THERMAL_FAULT_TARGET_C,
  THERMAL_FAULT_TAU_S,
  TUMBLE_PERIOD_S,
  type FaultState,
} from './faults.js';
import type { OrbitState } from './orbit.js';
import { gaussian, mulberry32 } from './prng.js';

export interface StationLink {
  stationId: string;
  elevDeg: number;
  rangeKm: number;
}

export interface StepInput {
  /** Simulated seconds since the previous step. */
  dtS: number;
  /** Simulated epoch ms (drives slow attitude variation). */
  simTimeMs: number;
  orbit: OrbitState;
  /** 0 sunlit .. 1 umbra. */
  shadow: number;
  /** Best visible ground station, or null when none is above its minimum elevation. */
  link: StationLink | null;
}

const CHARGE_EFFICIENCY = 0.92;
const DISCHARGE_EFFICIENCY = 0.97;
const COLD_PANEL_C = -30;
const PANEL_OVERHEAT_C = 90;
const PROP_BURN_KG_PER_S = 2e-6;
const PAYLOAD_PERIOD_S = 90;
const PAYLOAD_ON_S = 14;

export interface SpacecraftParams {
  baseLoadW: number;
  solarMaxW: number;
  capacityWh: number;
  panelDegradation: number;
  panelHotC: number;
  obcBaseC: number;
  panelTauS: number;
  obcTauS: number;
  attitudePeriodS: number;
  attitudePhase: number;
  tumbleRateDps: number;
  attBaseDps: number;
  initialPropKg: number;
  initialSoc: number;
  linkOffsetDb: number;
  noiseFloorDbm: number;
}

/**
 * Sized so the orbit-average power budget is positive and a typical eclipse costs ~15-25 % of
 * the battery, which makes the SoC sawtooth visible on a dashboard.
 */
export function paramsForSatellite(noradId: number): SpacecraftParams {
  const r = mulberry32(noradId);
  const baseLoadW = 40 + 110 * r();
  return {
    baseLoadW,
    solarMaxW: baseLoadW * (3.2 + 1.3 * r()),
    capacityWh: baseLoadW * (2.2 + 1.3 * r()),
    panelDegradation: 0.92 + 0.07 * r(),
    panelHotC: 45 + 15 * r(),
    obcBaseC: 20 + 15 * r(),
    panelTauS: 240 + 240 * r(),
    obcTauS: 900 + 600 * r(),
    attitudePeriodS: 600 + 900 * r(),
    attitudePhase: 2 * Math.PI * r(),
    tumbleRateDps: 3 + 5 * r(),
    attBaseDps: 0.03 + 0.04 * r(),
    initialPropKg: 8 + 50 * r(),
    initialSoc: 0.7 + 0.25 * r(),
    linkOffsetDb: -2 + 4 * r(),
    noiseFloorDbm: -126 + 4 * r(),
  };
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** First-order lag step that stays stable for any dt (exact exponential form). */
const lag = (current: number, target: number, dtS: number, tauS: number): number =>
  current + (target - current) * (1 - Math.exp(-dtS / tauS));

export class Spacecraft {
  readonly params: SpacecraftParams;
  private readonly rng: () => number;
  private soc: number;
  private panelTempC = 0;
  private obcTempC = 0;
  private propKg: number;
    private thermalInitialised = false;

  constructor(
    noradId: number,
    private readonly faults: FaultState,
  ) {
    this.params = paramsForSatellite(noradId);
    this.rng = mulberry32(noradId ^ 0x5eed5eed);
    this.soc = this.params.initialSoc;
    this.propKg = this.params.initialPropKg;
  }

  step(input: StepInput): TelemetryFrame {
    const { dtS, simTimeMs, orbit, shadow, link } = input;
    const p = this.params;
    const simS = simTimeMs / 1000;
    const noise = (sigma: number): number => gaussian(this.rng) * sigma;

    // --- power ---
    const solarW = p.solarMaxW * (1 - shadow) * this.attitudeFactor(simS) * p.panelDegradation;
    const loadW = this.loadW(simS);
    const netW = solarW - loadW;
    const energyWh =
      ((netW > 0 ? netW * CHARGE_EFFICIENCY : netW / DISCHARGE_EFFICIENCY) * dtS) / 3600;
    this.soc += energyWh / p.capacityWh;
    if (this.faults.has('battery')) this.soc -= BATTERY_FAULT_DRAIN_PER_S * dtS;
    this.soc = clamp(this.soc, 0, 1);
    const batV = 24 + 4.6 * this.soc + noise(0.03);
    const busA = loadW / batV + noise(0.05);

    // --- thermal ---
    this.stepThermal(dtS, shadow, loadW);

    // --- attitude / propulsion ---
    const tumbling = this.faults.has('tumble');
    const attRateDps = tumbling
      ? p.tumbleRateDps + noise(0.3)
      : clamp(p.attBaseDps + noise(0.015), 0.01, 0.1);
    this.propKg = Math.max(0, this.propKg - PROP_BURN_KG_PER_S * dtS);

    // A comms fault kills the carrier but not the geometry: the station is still in view (stationId and
    // elevation stay populated) while RSSI/SNR drop out, which is exactly what the link-loss rule looks for.
    const comms = this.faults.has('comms') ? null : this.commsFor(link);

    return {
      lat: orbit.lat,
      lon: orbit.lon,
      altKm: orbit.altKm,
      velKms: clamp(orbit.velKms, 0, 15),
      shadow: clamp(shadow, 0, 1),
      solarW,
      batSoc: this.soc,
      batV: clamp(batV, 0, 100),
      busA: clamp(busA, -100, 100),
      panelTempC: this.panelTempC + noise(0.3),
      obcTempC: this.obcTempC + noise(0.15),
      rssiDbm: comms?.rssiDbm ?? null,
      snrDb: comms?.snrDb ?? null,
      stationId: link?.stationId ?? null,
      elevDeg: link ? clamp(link.elevDeg, -90, 90) : null,
      attRateDps,
      propKg: this.propKg,
      mode: this.mode(shadow),
    };
  }

  /** Slow attitude-dependent array incidence; under a tumble it swings hard at TUMBLE_PERIOD_S. */
  private attitudeFactor(simS: number): number {
    if (this.faults.has('tumble')) {
      return clamp(0.55 + 0.45 * Math.sin((2 * Math.PI * simS) / TUMBLE_PERIOD_S), 0.05, 1);
    }
    return (
      0.85 +
      0.15 *
        Math.sin((2 * Math.PI * simS) / this.params.attitudePeriodS + this.params.attitudePhase)
    );
  }

  /**
   * Base load plus a scheduled payload-on window (suppressed in safe mode). The schedule is periodic with a
   * per-satellite phase, like real payload operations: a rolling baseline always contains it, so it is not
   * flagged as an anomaly (random clustered spikes were, since a quiet window made the next one look 5 sigma).
   */
  private loadW(simS: number): number {
    const safe = this.faults.safeMode;
    const phaseS = (this.params.attitudePhase / (2 * Math.PI)) * PAYLOAD_PERIOD_S;
    const inWindow = (((simS + phaseS) % PAYLOAD_PERIOD_S) + PAYLOAD_PERIOD_S) % PAYLOAD_PERIOD_S < PAYLOAD_ON_S;
    const payloadW = !safe && inWindow ? this.params.baseLoadW * 0.35 : 0;
    return this.params.baseLoadW * (safe ? SAFE_MODE_LOAD_FACTOR : 1) + payloadW;
  }

  private stepThermal(dtS: number, shadow: number, loadW: number): void {
    const p = this.params;
    const panelTarget = COLD_PANEL_C + (p.panelHotC - COLD_PANEL_C) * (1 - shadow);
    const obcTarget = p.obcBaseC + 6 * (1 - shadow) + 8 * (loadW / (p.baseLoadW * 1.35));
    if (!this.thermalInitialised) {
      this.panelTempC = panelTarget;
      this.obcTempC = obcTarget;
      this.thermalInitialised = true;
      return;
    }
    if (this.faults.has('thermal')) {
      this.panelTempC = lag(this.panelTempC, THERMAL_FAULT_TARGET_C, dtS, THERMAL_FAULT_TAU_S);
    } else {
      // After a fault clears, bleed the excess heat quickly instead of over many minutes.
      const tau = this.panelTempC > PANEL_OVERHEAT_C ? 20 : p.panelTauS;
      this.panelTempC = lag(this.panelTempC, panelTarget, dtS, tau);
    }
    this.obcTempC = lag(this.obcTempC, obcTarget, dtS, p.obcTauS);
  }

  /** Free-space-loss style: -92 dBm at 500 km, -6 dB per range doubling, clamped to -120..-90. */
  private commsFor(link: StationLink | null): { rssiDbm: number; snrDb: number } | null {
    if (!link) return null;
    const p = this.params;
    const rssi = clamp(
      -92 - 20 * Math.log10(link.rangeKm / 500) + p.linkOffsetDb + gaussian(this.rng) * 0.4,
      -120,
      -90,
    );
    return { rssiDbm: rssi, snrDb: rssi - p.noiseFloorDbm + gaussian(this.rng) * 0.3 };
  }

  private mode(shadow: number): TelemetryFrame['mode'] {
    if (this.faults.has('comms')) return 'LOS';
    if (this.faults.safeMode) return 'SAFE';
    if (this.faults.hasDegradingFault) return 'DEGRADED';
    return shadow > 0.5 ? 'ECLIPSE' : 'NOMINAL';
  }
}
