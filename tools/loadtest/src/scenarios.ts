// The scenario matrix (A-F). Each scenario boots its own server, so results do not depend on run order.
import type { ClientSwarm, ConnectSummary, Mix } from './clientSwarm.js';
import { MAX_HZ, type FloodOptions } from './ingestFlood.js';
import {
  measureWindow,
  openSwarm,
  withServer,
  type Env,
  type LimitMode,
  type LoadResult,
  type RunSettings,
} from './scenarioKit.js';

export interface ScenarioResult extends LoadResult {
  scenario: string;
  title: string;
  description: string;
  startedAt: string;
  serverLimits: LimitMode;
  /** The connection phase of the client swarm (null when the scenario has no clients). */
  connect: ConnectSummary | null;
  /** Scenario-specific extras: ramp steps, comparison phases, timelines. */
  extra: Record<string, unknown>;
  notes: string[];
}

type FloodSpec = Omit<FloodOptions, 'url' | 'apiKey' | 'durationS'>;

const MIX: Mix = { fleet: 70, group: 20, sat: 10 };
const SATELLITES = 64;
const REALISTIC_FLOOD: FloodSpec = {
  sources: SATELLITES,
  hz: 10,
  batchMs: 100,
  sockets: 4,
  honorBackoff: true,
};

export interface Scenario {
  id: string;
  title: string;
  run(settings: RunSettings): Promise<ScenarioResult>;
}

function header(id: string, title: string, description: string, limits: LimitMode) {
  return {
    scenario: id,
    title,
    description,
    startedAt: new Date().toISOString(),
    serverLimits: limits,
  };
}

/** Realistic fleet feed plus `clients` viewers: scenarios A, B and D differ only in client count. */
function viewerScenario(id: string, title: string, defaultClients: number): Scenario {
  return {
    id,
    title,
    async run(settings) {
      const clients = settings.clients ?? defaultClients;
      const description = `${SATELLITES} satellites at 10 Hz (${SATELLITES * 10} ev/s) plus ${clients} viewer clients (70% fleet, 20% group, 10% sat at 10 Hz).`;
      return withServer(settings, 'raised', async (env) => {
        const { swarm, connect } = await openSwarm(env, { count: clients, mix: MIX });
        try {
          const load = await measureWindow(env, {
            flood: REALISTIC_FLOOD,
            durationS: settings.durationS,
            swarm,
          });
          return {
            ...header(id, title, description, 'raised'),
            ...load,
            connect,
            extra: {},
            notes: [],
          };
        } finally {
          await swarm.close();
        }
      });
    },
  };
}

interface RampStep {
  offeredEventsPerSec: number;
  ackedEventsPerSec: number;
  ackP99Ms: number;
  rejectedEvents: number;
  ackTimeouts: number;
  serverCpuPctMean: number;
  eventLoopP99MsMax: number;
  passed: boolean;
}

const RAMP_TARGETS_EPS = [
  2_000, 5_000, 10_000, 20_000, 40_000, 64_000, 80_000, 100_000, 130_000, 160_000, 200_000, 260_000,
];
const RAMP_STEP_S = 8;
const ACK_P99_LIMIT_MS = 250;

async function floodAt(env: Env, swarm: ClientSwarm, eps: number, durationS: number) {
  const hz = Math.min(MAX_HZ, Math.max(1, Math.round(eps / SATELLITES)));
  const flood: FloodSpec = { ...REALISTIC_FLOOD, hz, sockets: 8 };
  return measureWindow(env, { flood, durationS, swarm });
}

const highIngest: Scenario = {
  id: 'C',
  title: 'High ingest, max sustainable',
  async run(settings) {
    const description = `${SATELLITES} sources with rising per-source rate and 100 viewer clients. Ramp until ack p99 > ${ACK_P99_LIMIT_MS} ms, rejections, timeouts or <95% of offered load acknowledged; then re-run the best passing level for the full window.`;
    return withServer(settings, 'raised', async (env) => {
      const { swarm, connect } = await openSwarm(env, { count: 100, mix: MIX });
      try {
        const steps: RampStep[] = [];
        let best = 0;
        for (const target of RAMP_TARGETS_EPS) {
          const { ingest, server } = await floodAt(env, swarm, target, RAMP_STEP_S);
          const f = ingest!;
          const passed =
            f.ackLatency.p99Ms <= ACK_P99_LIMIT_MS &&
            f.rejectedEvents === 0 &&
            f.ackTimeouts === 0 &&
            f.ackedEventsPerSec >= 0.95 * f.offeredEventsPerSec;
          steps.push({
            offeredEventsPerSec: f.offeredEventsPerSec,
            ackedEventsPerSec: f.ackedEventsPerSec,
            ackP99Ms: f.ackLatency.p99Ms,
            rejectedEvents: f.rejectedEvents,
            ackTimeouts: f.ackTimeouts,
            serverCpuPctMean: server.cpuPct.mean,
            eventLoopP99MsMax: server.eventLoopP99Ms.max,
            passed,
          });
          if (!passed) break;
          best = target;
        }
        const notes: string[] = [];
        if (best === 0) {
          notes.push('Even the lowest ramp level failed its pass criteria.');
          best = RAMP_TARGETS_EPS[0]!;
        } else if (best === RAMP_TARGETS_EPS.at(-1)) {
          notes.push('Every ramp level passed: the maximum is above the highest level tried.');
        }
        const confirm = await floodAt(env, swarm, best, settings.durationS);
        return {
          ...header('C', highIngest.title, description, 'raised'),
          ...confirm,
          connect,
          extra: { ramp: steps, confirmedTargetEventsPerSec: best },
          notes,
        };
      } finally {
        await swarm.close();
      }
    });
  },
};

/** Default device limits (3000 ev/s sustained, 6000 burst per 10 s) against a flood of ~12,800 ev/s. */
const rateLimited: Scenario = {
  id: 'E',
  title: 'Rate limiting and backpressure',
  async run(settings) {
    const description = `Default device limits (3000 ev/s, 6000 burst/10 s). ${SATELLITES} sources at 200 Hz (12,800 ev/s offered) with 50 viewer clients. Phase 1 ignores retryAfterMs (aggressive flood), phase 2 honours it (well-behaved producer).`;
    return withServer(settings, 'default', async (env) => {
      const { swarm, connect } = await openSwarm(env, { count: 50, mix: MIX });
      try {
        const flood: FloodSpec = { ...REALISTIC_FLOOD, hz: 200, sockets: 4 };
        const aggressive = await measureWindow(env, {
          flood: { ...flood, honorBackoff: false },
          durationS: settings.durationS,
          swarm,
        });
        const cooperative = await measureWindow(env, {
          flood: { ...flood, honorBackoff: true },
          durationS: settings.durationS,
          swarm,
        });
        const healthy = await fetch(`${env.url}/healthz`).then((r) => r.ok);
        return {
          ...header('E', rateLimited.title, description, 'default'),
          ...aggressive,
          connect,
          extra: {
            cooperative: {
              ingest: cooperative.ingest,
              clients: cooperative.clients,
              server: cooperative.server,
            },
            healthzOkAfter: healthy,
          },
          notes: [],
        };
      } finally {
        await swarm.close();
      }
    });
  },
};

const STALL_WINDOW_S = 60;

/** One viewer stops reading its socket; the others must be unaffected while the server sheds it. */
const slowConsumer: Scenario = {
  id: 'F',
  title: 'Slow consumer',
  async run(settings) {
    const durationS = Math.max(settings.durationS, STALL_WINDOW_S);
    const description = `${SATELLITES} satellites at 10 Hz, 100 normal viewers plus 1 viewer that subscribes to fleet, all groups and 40 sat rooms at 10 Hz and then stops reading its TCP socket. The stalled client is resumed after ${durationS} s to see how the server ended the connection.`;
    return withServer(settings, 'raised', async (env) => {
      const { swarm, connect } = await openSwarm(env, { count: 100, mix: MIX, stalled: 1 });
      try {
        const startT = env.sampler.elapsed;
        const load = await measureWindow(env, { flood: REALISTIC_FLOOD, durationS, swarm });
        const samples = env.sampler.window(startT, env.sampler.elapsed);
        const firstSlow = samples.find((s) => s.stats.broadcast.slowConsumers >= 1);
        const total = connect.connected;
        const gone = samples.find((s) => s.t > startT + 1 && s.stats.clients.telemetry < total);
        await swarm.resumeStalled();
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const after = await swarm.endMeasure();
        return {
          ...header('F', slowConsumer.title, description, 'raised'),
          ...load,
          connect,
          extra: {
            secondsToDowngrade: firstSlow ? Math.round((firstSlow.t - startT) * 10) / 10 : null,
            secondsToDisconnect: gone ? Math.round((gone.t - startT) * 10) / 10 : null,
            stalledClientAfterResume: after.stalled,
            serverSlowConsumerLogLines: env.logLines.filter((l) => l.includes('slow consumer'))
              .length,
          },
          notes: [],
        };
      } finally {
        await swarm.close();
      }
    });
  },
};

export const SCENARIOS: Scenario[] = [
  viewerScenario('A', 'Baseline realistic', 100),
  viewerScenario('B', 'Many viewers', 1000),
  highIngest,
  viewerScenario('D', 'Viewer capacity', 5000),
  rateLimited,
  slowConsumer,
];
