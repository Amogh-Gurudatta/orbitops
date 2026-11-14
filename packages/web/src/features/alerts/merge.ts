// Merges REST pages with live socket updates into the list the alarm table shows.
import type { Alert } from '@orbitops/shared';
import { matchesFilters, type AlertFilters } from './filters.ts';

/**
 * Dedupes by id with live rows replacing REST rows (they are newer: a live ack/resolve/count update
 * must win over the page fetched earlier), then re-applies the filters so an alert that just left
 * the filter (e.g. acked while viewing OPEN) disappears, and sorts newest-opened first.
 */
export function mergeAlerts(
  rest: readonly Alert[],
  live: readonly Alert[],
  filters: AlertFilters,
): Alert[] {
  const byId = new Map<string, Alert>();
  for (const alert of rest) byId.set(alert.id, alert);
  for (const alert of live) byId.set(alert.id, alert);
  return [...byId.values()]
    .filter((alert) => matchesFilters(alert, filters))
    .sort((a, b) => b.openedAt - a.openedAt || (a.id < b.id ? 1 : -1));
}
