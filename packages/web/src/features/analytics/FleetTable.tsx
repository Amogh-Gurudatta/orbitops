// Per-group aggregates of the heatmap metric over the selected range.
import { useMemo } from 'react';
import type { Heatmap, Satellite } from '../../api/types.ts';
import { METRIC_META } from '../../realtime/metrics.ts';
import { Panel, Table, TBody, TD, TH, THead, TR } from '../../ui/index.ts';
import type { Limits } from '../../charts/StripChart.tsx';
import { groupAggregates } from './heatmap.ts';
import type { AnalyticsMetric } from './metrics.ts';

export function FleetTable({
  data,
  metric,
  limits,
  catalog,
}: {
  data: Heatmap;
  metric: AnalyticsMetric;
  limits: Limits | undefined;
  catalog: Readonly<Record<number, Satellite>>;
}) {
  const meta = METRIC_META[metric];
  const rows = useMemo(
    () => groupAggregates(data, (id) => catalog[id]?.group, limits),
    [data, catalog, limits],
  );
  const fmt = (v: number | null) => (v === null ? '—' : (v * meta.scale).toFixed(meta.decimals));
  return (
    <Panel
      title="FLEET BY GROUP"
      subtitle={`${meta.label} (${meta.unit}) · MEAN OF BUCKET AVERAGES`}
      flush
    >
      <div className="h-full overflow-auto">
        <Table>
          <THead>
            <TR>
              <TH>GROUP</TH>
              <TH numeric>SATS</TH>
              <TH numeric>MEAN</TH>
              <TH numeric>MIN</TH>
              <TH numeric>MAX</TH>
              <TH numeric>BEYOND LIMIT</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.group}>
                <TD className="mnemonic text-xs">{r.group}</TD>
                <TD numeric>{r.sats}</TD>
                <TD numeric>{fmt(r.mean)}</TD>
                <TD numeric>{fmt(r.min)}</TD>
                <TD numeric>{fmt(r.max)}</TD>
                <TD numeric className={r.beyondLimit ? 'text-caution' : 'text-text-dim'}>
                  {r.beyondLimit === null ? '—' : `${(r.beyondLimit * 100).toFixed(1)} %`}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </Panel>
  );
}
