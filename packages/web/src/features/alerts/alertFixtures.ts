// Test fixture builder for Alert records.
import type { Alert } from '@orbitops/shared';

export function makeAlert(overrides: Partial<Alert> & Pick<Alert, 'id'>): Alert {
  return {
    key: `${overrides.satId ?? 1}:${overrides.ruleId ?? 'tcs.panelOverTemp'}`,
    satId: 1,
    ruleId: 'tcs.panelOverTemp',
    subsystem: 'TCS',
    severity: 'CAUTION',
    state: 'open',
    message: 'Solar panel over-temperature',
    value: 72,
    threshold: 70,
    openedAt: 1_000_000,
    lastSeenAt: 1_000_000,
    count: 1,
    ...overrides,
  };
}
