// Prometheus exposition (@prometheus-io/client). Counters mirror the StatsCollector totals at scrape time,
// so the pipeline only ever increments one set of numbers.
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import type { CounterName, StatsCollector } from './collector.js';

const COUNTERS: { name: CounterName; metric: string; help: string }[] = [
  { name: 'accepted', metric: 'orbitops_ingest_accepted_total', help: 'Telemetry events accepted' },
  {
    name: 'duplicates',
    metric: 'orbitops_ingest_duplicates_total',
    help: 'Duplicate events dropped',
  },
  {
    name: 'outOfOrder',
    metric: 'orbitops_ingest_out_of_order_total',
    help: 'Events reordered within the hold window',
  },
  {
    name: 'late',
    metric: 'orbitops_ingest_late_total',
    help: 'Events arriving after their slot was released',
  },
  {
    name: 'malformed',
    metric: 'orbitops_ingest_malformed_total',
    help: 'Events rejected by validation',
  },
  {
    name: 'rateLimited',
    metric: 'orbitops_ingest_rate_limited_total',
    help: 'Events rejected by the device rate limit',
  },
  {
    name: 'gapsSkipped',
    metric: 'orbitops_ingest_gaps_skipped_total',
    help: 'Missing seqs skipped after the reorder hold',
  },
  {
    name: 'dropped',
    metric: 'orbitops_store_dropped_total',
    help: 'Samples shed from the full write queue',
  },
  {
    name: 'persisted',
    metric: 'orbitops_store_persisted_total',
    help: 'Samples written to MongoDB',
  },
  {
    name: 'messages',
    metric: 'orbitops_broadcast_messages_total',
    help: 'Socket messages sent to clients',
  },
  {
    name: 'bytes',
    metric: 'orbitops_broadcast_bytes_total',
    help: 'Approximate payload bytes sent to clients',
  },
];

export function createPrometheusRegistry(stats: StatsCollector): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  for (const { name, metric, help } of COUNTERS) {
    let reported = 0;
    new Counter({
      name: metric,
      help,
      registers: [registry],
      collect() {
        const total = stats.total(name);
        this.inc(total - reported);
        reported = total;
      },
    });
  }

  const gauge = (name: string, help: string, read: () => number) =>
    new Gauge({
      name,
      help,
      registers: [registry],
      collect() {
        this.set(read());
      },
    });
  const snap = () => stats.snapshot();
  gauge(
    'orbitops_ingest_events_per_second',
    'Accepted events per second',
    () => snap().ingest.eventsPerSec,
  );
  gauge(
    'orbitops_store_queue_depth',
    'Samples waiting to be persisted',
    () => snap().store.queueDepth,
  );
  gauge(
    'orbitops_broadcast_slow_consumers',
    'Clients currently downgraded as slow',
    () => snap().broadcast.slowConsumers,
  );
  gauge(
    'orbitops_event_loop_delay_p50_ms',
    'Event loop delay p50 (ms)',
    () => snap().eventLoop.p50Ms,
  );
  gauge(
    'orbitops_event_loop_delay_p99_ms',
    'Event loop delay p99 (ms)',
    () => snap().eventLoop.p99Ms,
  );
  gauge(
    'orbitops_latency_p50_ms',
    'Client-reported end-to-end latency p50 (ms)',
    () => snap().latency.p50,
  );
  gauge(
    'orbitops_latency_p95_ms',
    'Client-reported end-to-end latency p95 (ms)',
    () => snap().latency.p95,
  );
  gauge(
    'orbitops_latency_p99_ms',
    'Client-reported end-to-end latency p99 (ms)',
    () => snap().latency.p99,
  );

  const clients = new Gauge({
    name: 'orbitops_clients',
    help: 'Connected socket clients per namespace',
    labelNames: ['namespace'],
    registers: [registry],
    collect() {
      const c = snap().clients;
      this.set({ namespace: 'telemetry' }, c.telemetry);
      this.set({ namespace: 'alerts' }, c.alerts);
      this.set({ namespace: 'ingest' }, c.ingest);
    },
  });
  void clients;

  const flush = new Histogram({
    name: 'orbitops_store_flush_duration_ms',
    help: 'MongoDB batch insert duration (ms)',
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
    registers: [registry],
  });
  stats.onFlushObserved = (ms) => flush.observe(ms);

  return registry;
}
