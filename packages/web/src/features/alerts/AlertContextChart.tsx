// Mini strip chart of the metric behind an alert, over the alert's lifetime (REST history), with the
// rule's threshold drawn as the limit line.
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Alert, AlertRule } from '@orbitops/shared';
import { fetchHistory } from '../../api/endpoints.ts';
import { StripChart, type Limits, type StripChartHandle } from '../../charts/StripChart.tsx';
import { METRIC_META, type NumericMetric } from '../../realtime/metrics.ts';
import { ErrorState, LoadingState } from '../../ui/index.ts';
import { alertWindow } from './ruleMetric.ts';

function limitsFor(alert: Alert, rule: AlertRule | undefined, scale: number): Limits | undefined {
  if (!rule || rule.kind === 'stale' || rule.kind === 'zscore') return undefined;
  const value = rule.threshold * scale;
  const pair = rule.op === '>' ? { hi: value } : { lo: value };
  return alert.severity === 'WARNING' ? { warning: pair } : { caution: pair };
}

export function AlertContextChart({
  alert,
  metric,
  rule,
}: {
  alert: Alert;
  metric: NumericMetric;
  rule: AlertRule | undefined;
}) {
  const handle = useRef<StripChartHandle>(null);
  const meta = METRIC_META[metric];
  // The window is fixed per alert state so live count updates do not refetch.
  const window = useMemo(() => alertWindow(alert, Date.now()), [alert.id, alert.resolvedAt]);

  const history = useQuery({
    queryKey: ['alert-context', alert.satId, metric, window.from, window.to],
    queryFn: () =>
      fetchHistory({ satId: alert.satId, from: window.from, to: window.to, metrics: [metric] }),
  });

  useEffect(() => {
    const data = history.data;
    if (!data) return;
    const values = data.series[metric] ?? [];
    handle.current?.setData(
      data.t.map((ms) => ms / 1000),
      [values.map((v) => (v === null ? null : v * meta.scale))],
    );
  }, [history.data, metric, meta.scale]);

  if (history.isError)
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  return (
    <div className="relative h-full min-h-0">
      <StripChart
        key={metric}
        ref={handle}
        aria-label={`${meta.label} around alert`}
        series={[{ label: meta.label, unit: meta.unit, decimals: meta.decimals }]}
        limits={limitsFor(alert, rule, meta.scale)}
        gapSeconds={120}
        className="min-h-0!"
      />
      {history.isPending && (
        <div className="absolute inset-0 bg-panel">
          <LoadingState label="LOADING HISTORY" />
        </div>
      )}
    </div>
  );
}
