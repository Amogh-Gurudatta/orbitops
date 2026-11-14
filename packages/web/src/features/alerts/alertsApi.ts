// REST helpers and query keys for the alerts page.
import type { Alert, AlertRule } from '@orbitops/shared';
import { api } from '../../api/client.ts';
import { filtersToQuery, type AlertFilters } from './filters.ts';

export const PAGE_SIZE = 100;

export const alertKeys = {
  list: (filters: AlertFilters) => ['alerts', 'list', filtersToQuery(filters)] as const,
  listRoot: ['alerts', 'list'] as const,
  rules: ['alert-rules'] as const,
};

/** One page of alerts, newest-opened first; `before` is the previous page's last `openedAt`. */
export const fetchAlertPage = (
  filters: AlertFilters,
  before: number | undefined,
  signal: AbortSignal,
) =>
  api
    .get<{ alerts: Alert[] }>('/alerts', {
      query: { ...filtersToQuery(filters), limit: PAGE_SIZE, before },
      signal,
    })
    .then((r) => r.alerts);

export const ackAlert = (id: string) =>
  api.post<{ alert: Alert }>(`/alerts/${encodeURIComponent(id)}/ack`).then((r) => r.alert);

export const resolveAlert = (id: string) =>
  api.post<{ alert: Alert }>(`/alerts/${encodeURIComponent(id)}/resolve`).then((r) => r.alert);

export const fetchRules = () =>
  api.get<{ rules: AlertRule[] }>('/alert-rules').then((r) => r.rules);

export type RulePatch = Partial<
  Pick<AlertRule, 'threshold' | 'severity' | 'enabled' | 'samples' | 'clearRatio' | 'windowSize'>
>;

export const updateRule = (id: string, patch: RulePatch) =>
  api.put<{ rule: AlertRule }>(`/alert-rules/${encodeURIComponent(id)}`, patch).then((r) => r.rule);
