// Worst active alert severity of one subsystem on one satellite, mapped to Panel state.
import { useMemo } from 'react';
import type { Alert, Subsystem } from '@orbitops/shared';
import { useAlertsStore } from '../../realtime/alertsStore.ts';

/** Alerts of this satellite that have not been resolved (open or acknowledged). */
export function useActiveSatAlerts(satId: number): Alert[] {
  const alerts = useAlertsStore((s) => s.alerts);
  return useMemo(
    () => alerts.filter((a) => a.satId === satId && a.state !== 'resolved'),
    [alerts, satId],
  );
}

export function useSubsystemState(
  satId: number,
  subsystem: Subsystem,
): 'caution' | 'warning' | undefined {
  const active = useActiveSatAlerts(satId);
  return useMemo(() => {
    let state: 'caution' | 'warning' | undefined;
    for (const a of active) {
      if (a.subsystem !== subsystem) continue;
      if (a.severity === 'WARNING') return 'warning';
      if (a.severity === 'CAUTION') state = 'caution';
    }
    return state;
  }, [active, subsystem]);
}
