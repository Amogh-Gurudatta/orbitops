// Building blocks the scenarios share: a server lifecycle (spawned or external), and one measured load
// window that runs the ingest flood and the client swarm together while sampling the server.
import { catalogueSatIds, login } from './api.js';
import {
  buildSpecs,
  ClientSwarm,
  type ConnectSummary,
  type Mix,
  type SwarmResult,
} from './clientSwarm.js';
import { runIngestFlood, type FloodOptions, type FloodResult } from './ingestFlood.js';
import { LOADTEST_ENV, startServerProcess, RAISED_LIMITS } from './serverProcess.js';
import { ServerSampler, summarizeWindow, type ServerWindowSummary } from './stats.js';

export interface RunSettings {
  port: number;
  /** Measured window per scenario, seconds. */
  durationS: number;
  /** Overrides the viewer count of the viewer scenarios (A, B, D). */
  clients?: number;
  /** Use an already running server instead of spawning one. */
  external?: { url: string; pid: number };
}

export interface Env {
  url: string;
  token: string;
  pid: number;
  sampler: ServerSampler;
  satIds: number[];
  logLines: string[];
}

export type LimitMode = 'raised' | 'default';

/** Boots (or attaches to) a server, logs in once, runs `body`, then always tears everything down. */
export async function withServer<T>(
  settings: RunSettings,
  limits: LimitMode,
  body: (env: Env) => Promise<T>,
): Promise<T> {
  const server = settings.external
    ? undefined
    : await startServerProcess(settings.port, limits === 'raised' ? RAISED_LIMITS : {});
  const url = settings.external?.url ?? server!.url;
  const pid = settings.external?.pid ?? server!.pid;
  try {
    const token = await login(url);
    const live = new ServerSampler(url, token, pid);
    live.start();
    try {
      return await body({
        url,
        token,
        pid,
        sampler: live,
        satIds: await catalogueSatIds(),
        logLines: server?.logLines ?? [],
      });
    } finally {
      live.stop();
    }
  } finally {
    await server?.stop();
  }
}

export interface LoadSpec {
  flood: Omit<FloodOptions, 'url' | 'apiKey' | 'durationS'> | null;
  durationS: number;
  swarm: ClientSwarm | null;
}

export interface LoadResult {
  ingest: FloodResult | null;
  clients: SwarmResult | null;
  server: ServerWindowSummary;
}

const WARMUP_S = 2;

/** One measured window: flood + swarm run together for `durationS`, server sampled throughout. */
export async function measureWindow(env: Env, spec: LoadSpec): Promise<LoadResult> {
  const { sampler } = env;
  const fromT = sampler.elapsed + WARMUP_S;
  await spec.swarm?.beginMeasure();
  const ingestPromise = spec.flood
    ? runIngestFlood({
        ...spec.flood,
        url: env.url,
        apiKey: LOADTEST_ENV.DEVICE_API_KEY,
        durationS: spec.durationS,
      })
    : new Promise<null>((resolve) => setTimeout(() => resolve(null), spec.durationS * 1000));
  const ingest = await ingestPromise;
  const toT = sampler.elapsed;
  const clients = spec.swarm ? await spec.swarm.endMeasure() : null;
  return { ingest, clients, server: summarizeWindow(sampler.window(fromT, toT)) };
}

export interface SwarmSetup {
  count: number;
  mix: Mix;
  stalled?: number;
  workers?: number;
  rampPerSec?: number;
}

/** Connects the swarm before any load starts, so the measured window sees steady state only. */
export async function openSwarm(
  env: Env,
  setup: SwarmSetup,
): Promise<{ swarm: ClientSwarm; connect: ConnectSummary }> {
  const swarm = new ClientSwarm({ url: env.url, token: env.token }, setup.workers ?? 4);
  const specs = buildSpecs(setup.count, setup.mix, env.satIds, setup.stalled ?? 0);
  const connect = await swarm.connect(specs, setup.rampPerSec ?? 400);
  return { swarm, connect };
}
