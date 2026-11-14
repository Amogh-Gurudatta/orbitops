// Fault and mode state for one satellite, driven by operator COMMAND events (shared `Command`).
// The physics model reads this state; the tunables below define how each fault looks in telemetry.
import type { Command, FaultKind } from '@orbitops/shared';

/** Battery fault: internal short, drains this fraction of full charge per sim second (0.9 -> 0.2 in ~14 s). */
export const BATTERY_FAULT_DRAIN_PER_S = 0.05;
/** Thermal fault: panel temperature is pulled toward this target with this time constant. */
export const THERMAL_FAULT_TARGET_C = 150;
export const THERMAL_FAULT_TAU_S = 15;
/** Tumble fault: solar array incidence oscillates with this period (sim seconds). */
export const TUMBLE_PERIOD_S = 5;
/** Safe mode sheds non-essential loads. */
export const SAFE_MODE_LOAD_FACTOR = 0.4;

export class FaultState {
  private readonly active = new Set<FaultKind>();
  safeMode = false;

  has(kind: FaultKind): boolean {
    return this.active.has(kind);
  }

  /** A fault that degrades the spacecraft itself (comms loss is reported as LOS, not DEGRADED). */
  get hasDegradingFault(): boolean {
    return this.active.has('battery') || this.active.has('thermal') || this.active.has('tumble');
  }

  list(): FaultKind[] {
    return [...this.active];
  }

  apply(command: Command): void {
    switch (command.kind) {
      case 'inject_fault':
        if (command.fault) this.active.add(command.fault);
        break;
      case 'clear_fault':
        // Without a fault type, clear everything.
        if (command.fault) this.active.delete(command.fault);
        else this.active.clear();
        break;
      case 'safe_mode':
        this.safeMode = true;
        break;
      case 'nominal_mode':
        this.safeMode = false;
        break;
    }
  }
}
