// Alert list filters: URL <-> filter state, REST query mapping and row matching. Pure and unit-tested.
// The server filters by state / severity / satellite; subsystem is applied on the client.
import {
  ALERT_STATES,
  SEVERITIES,
  SUBSYSTEMS,
  type Alert,
  type AlertState,
  type Severity,
  type Subsystem,
} from '@orbitops/shared';

export type StateFilter = AlertState | 'all';

export const STATE_FILTERS: readonly StateFilter[] = [...ALERT_STATES, 'all'];

export interface AlertFilters {
  state: StateFilter;
  severity: Severity | null;
  subsystem: Subsystem | null;
  satId: number | null;
}

export const DEFAULT_FILTERS: AlertFilters = {
  state: 'all',
  severity: null,
  subsystem: null,
  satId: null,
};

/** Case-insensitive lookup so `?severity=warning` and the lamps' `?severity=WARNING` both work. */
function pick<T extends string>(options: readonly T[], raw: string | null): T | null {
  if (!raw) return null;
  const wanted = raw.toUpperCase();
  return options.find((option) => option.toUpperCase() === wanted) ?? null;
}

export function parseFilters(params: URLSearchParams): AlertFilters {
  const satRaw = params.get('satId');
  const satId = satRaw !== null && /^\d{1,9}$/.test(satRaw) ? Number(satRaw) : null;
  return {
    state: pick(STATE_FILTERS, params.get('state')) ?? DEFAULT_FILTERS.state,
    severity: pick(SEVERITIES, params.get('severity')),
    subsystem: pick(SUBSYSTEMS, params.get('subsystem')),
    satId,
  };
}

/** Only non-default filters are written, keeping the URL short and shareable. */
export function filtersToParams(filters: AlertFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.state !== DEFAULT_FILTERS.state) params.set('state', filters.state);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.subsystem) params.set('subsystem', filters.subsystem);
  if (filters.satId !== null) params.set('satId', String(filters.satId));
  return params;
}

/** Query string for GET /alerts (everything the server can filter on). */
export function filtersToQuery(filters: AlertFilters): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (filters.state !== 'all') query.state = filters.state;
  if (filters.severity) query.severity = filters.severity;
  if (filters.satId !== null) query.satId = filters.satId;
  return query;
}

export function matchesFilters(alert: Alert, filters: AlertFilters): boolean {
  return (
    (filters.state === 'all' || alert.state === filters.state) &&
    (filters.severity === null || alert.severity === filters.severity) &&
    (filters.subsystem === null || alert.subsystem === filters.subsystem) &&
    (filters.satId === null || alert.satId === filters.satId)
  );
}
