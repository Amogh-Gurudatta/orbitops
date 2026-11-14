// The pipeline sections of the system page: INGEST, BROADCAST, STORE, CLIENTS, RUNTIME, LATENCY.
import { Panel, Table, TBody, TD, TH, THead, TR } from '../../ui/index.ts';
import { useFleetStore } from '../../realtime/fleetStore.ts';
import { cx } from '../../lib/cx.ts';
import type { PipelineStats } from '../../api/types.ts';
import { PipelineChart } from './PipelineChart.tsx';
import { Sparkline } from './Sparkline.tsx';
import { fmt1, fmtInt, StatLine } from './StatLine.tsx';
import type { StatKey, StatsHistory } from './statsHistory.ts';

export interface SectionProps {
  history: StatsHistory;
  stats: PipelineStats | null;
}

const TREND_SAMPLES = 60;

const COUNTERS: { key: StatKey; label: string; meaning: string; defence: boolean }[] = [
  { key: 'accepted', label: 'ACCEPTED', meaning: 'validated and queued', defence: false },
  {
    key: 'duplicates',
    label: 'DUPLICATES',
    meaning: 'same sequence seen twice, dropped',
    defence: true,
  },
  {
    key: 'outOfOrder',
    label: 'OUT OF ORDER',
    meaning: 'held in the reorder buffer, re-sequenced',
    defence: true,
  },
  { key: 'late', label: 'LATE', meaning: 'too old to re-sequence, stored flagged', defence: true },
  {
    key: 'malformed',
    label: 'MALFORMED',
    meaning: 'failed schema validation, rejected',
    defence: true,
  },
  {
    key: 'rateLimited',
    label: 'RATE LIMITED',
    meaning: 'source over its budget, shed',
    defence: true,
  },
  { key: 'dropped', label: 'DROPPED', meaning: 'queue overflow', defence: true },
];

function formatUptime(totalS: number): string {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = Math.floor(totalS % 60);
  return `${h}H ${String(m).padStart(2, '0')}M ${String(s).padStart(2, '0')}S`;
}

export function IngestPanel({ history, stats }: SectionProps) {
  return (
    <Panel
      title="INGEST"
      subtitle="DEVICE -> VALIDATE -> DEDUP -> REORDER -> STORE"
      flush
      bodyClassName="flex flex-col overflow-auto"
    >
      <PipelineChart
        history={history}
        samples={stats}
        label="Ingest events per second, last five minutes"
        series={[{ key: 'eventsPerSec', label: 'EVENTS/S', unit: 'ev/s', decimals: 0 }]}
      />
      <Table>
        <THead>
          <TR>
            <TH>COUNTER</TH>
            <TH numeric>TOTAL</TH>
            <TH numeric>/S</TH>
            <TH>60 S</TH>
            <TH>MEANING</TH>
          </TR>
        </THead>
        <TBody>
          {COUNTERS.map(({ key, label, meaning, defence }) => {
            const rate = history.latestRate(key);
            return (
              <TR key={key}>
                <TD className="mnemonic text-xs">{label}</TD>
                <TD numeric>{fmtInt(history.latest(key))}</TD>
                <TD
                  numeric
                  className={cx(rate > 0 && defence ? 'font-bold text-text' : 'text-text-dim')}
                >
                  {rate.toFixed(rate >= 100 ? 0 : 1)}
                </TD>
                <TD>
                  <Sparkline
                    values={history.rates(key).slice(-TREND_SAMPLES)}
                    label={`${label} per second trend`}
                  />
                </TD>
                <TD className="text-xs text-text-dim">{meaning}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p className="num px-1 py-0.5 text-2xs text-text-dim">
        UPTIME {stats ? formatUptime(stats.uptimeS) : '—'}
      </p>
    </Panel>
  );
}

export function BroadcastPanel({ history, stats }: SectionProps) {
  const bytesPerMsg = history.latest('bytesPerMsg');
  return (
    <Panel title="BROADCAST" subtitle="SERVER -> BROWSERS" flush bodyClassName="flex flex-col">
      <PipelineChart
        history={history}
        samples={stats}
        label="Broadcast bytes per second, last five minutes"
        series={[{ key: 'bytesPerSec', label: 'BYTES/S', unit: 'B/s', decimals: 0 }]}
      />
      <StatLine label="MSGS / S" value={fmt1(history.latest('msgsPerSec'))} unit="msg/s" />
      <StatLine label="BYTES / S" value={fmtInt(history.latest('bytesPerSec'))} unit="B/s" />
      <StatLine
        label="BYTES / MSG"
        value={fmt1(bytesPerMsg)}
        unit="B"
        note="Derived: compact msgpack deltas keep each message small"
      />
      <StatLine label="SLOW CONSUMERS" value={fmtInt(history.latest('slowConsumers'))} />
    </Panel>
  );
}

export function StorePanel({ history, stats }: SectionProps) {
  return (
    <Panel title="STORE" subtitle="BATCHED TIME-SERIES WRITES" flush bodyClassName="flex flex-col">
      <PipelineChart
        history={history}
        samples={stats}
        label="Store flush latency, last five minutes"
        series={[
          { key: 'flushMsP50', label: 'FLUSH P50', unit: 'ms', decimals: 1 },
          { key: 'flushMsP99', label: 'P99', unit: 'ms', decimals: 1 },
        ]}
      />
      <StatLine label="QUEUE DEPTH" value={fmtInt(history.latest('queueDepth'))} unit="ev" />
      <StatLine label="FLUSH P50" value={fmt1(history.latest('flushMsP50'))} unit="ms" />
      <StatLine label="FLUSH P99" value={fmt1(history.latest('flushMsP99'))} unit="ms" />
      <StatLine label="PERSISTED" value={fmtInt(history.latest('persisted'))} unit="total" />
    </Panel>
  );
}

export function ClientsPanel({ stats }: SectionProps) {
  const c = stats?.clients;
  return (
    <Panel title="CLIENTS" subtitle="CONNECTED SOCKETS" flush>
      <StatLine label="TELEMETRY" value={c ? fmtInt(c.telemetry) : '—'} unit="conn" />
      <StatLine label="ALERTS" value={c ? fmtInt(c.alerts) : '—'} unit="conn" />
      <StatLine label="INGEST" value={c ? fmtInt(c.ingest) : '—'} unit="conn" />
    </Panel>
  );
}

export function RuntimePanel({ history, stats }: SectionProps) {
  return (
    <Panel title="RUNTIME" subtitle="NODE PROCESS" flush bodyClassName="flex flex-col">
      <PipelineChart
        history={history}
        samples={stats}
        label="Event loop delay, last five minutes"
        series={[
          { key: 'loopP50', label: 'LOOP P50', unit: 'ms', decimals: 1 },
          { key: 'loopP99', label: 'P99', unit: 'ms', decimals: 1 },
        ]}
      />
      <StatLine label="EVENT LOOP P50" value={fmt1(history.latest('loopP50'))} unit="ms" />
      <StatLine label="EVENT LOOP P99" value={fmt1(history.latest('loopP99'))} unit="ms" />
      <StatLine label="RSS" value={fmt1(history.latest('rssMb'))} unit="MB" />
      <StatLine label="HEAP" value={fmt1(history.latest('heapMb'))} unit="MB" />
    </Panel>
  );
}

export function LatencyPanel({ history, stats }: SectionProps) {
  const client = useFleetStore((s) => s.latency);
  return (
    <Panel title="LATENCY" subtitle="SAMPLE TIME -> BROWSER" flush bodyClassName="flex flex-col">
      <PipelineChart
        history={history}
        samples={stats}
        label="End-to-end latency percentiles, last five minutes"
        series={[
          { key: 'latP50', label: 'E2E P50', unit: 'ms', decimals: 0 },
          { key: 'latP95', label: 'P95', unit: 'ms', decimals: 0 },
          { key: 'latP99', label: 'P99', unit: 'ms', decimals: 0 },
        ]}
      />
      <p className="mnemonic border-b border-grid px-1 py-0.5 text-2xs text-text-dim">
        SERVER-AGGREGATED, ALL CLIENTS
      </p>
      <StatLine label="E2E P50" value={fmtInt(history.latest('latP50'))} unit="ms" />
      <StatLine label="E2E P95" value={fmtInt(history.latest('latP95'))} unit="ms" />
      <StatLine label="E2E P99" value={fmtInt(history.latest('latP99'))} unit="ms" />
      <p className="mnemonic border-b border-grid px-1 py-0.5 text-2xs text-text-dim">
        THIS CLIENT
      </p>
      <StatLine label="P50" value={client ? fmtInt(client.p50) : '—'} unit="ms" />
      <StatLine label="P95" value={client ? fmtInt(client.p95) : '—'} unit="ms" />
      <StatLine label="P99" value={client ? fmtInt(client.p99) : '—'} unit="ms" />
      <StatLine label="SAMPLES" value={client ? fmtInt(client.n) : '—'} />
      <StatLine
        label="CLOCK OFFSET"
        value={client ? `${client.offsetMs >= 0 ? '+' : ''}${fmt1(client.offsetMs)}` : '—'}
        unit="ms"
        note="Estimated server clock minus this browser's clock"
      />
    </Panel>
  );
}
