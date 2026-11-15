// Result output: machine description, per-scenario JSON files and the markdown summary table.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import type { ScenarioResult } from './scenarios.js';

export const RESULTS_DIR = resolve(import.meta.dirname, '../results');

export interface MachineInfo {
  cpuModel: string;
  logicalCores: number;
  ramGiB: number;
  node: string;
  os: string;
  kernel: string;
}

export function machineInfo(): MachineInfo {
  const cpus = os.cpus();
  return {
    cpuModel: cpus[0]?.model.trim() ?? 'unknown',
    logicalCores: cpus.length,
    ramGiB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
    os: `${os.type()} ${os.arch()}`,
    kernel: os.release(),
  };
}

export async function writeResult(result: ScenarioResult, suffix = ''): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = resolve(RESULTS_DIR, `${result.scenario}${suffix}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}

export async function writeMachine(): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(
    resolve(RESULTS_DIR, 'machine.json'),
    `${JSON.stringify(machineInfo(), null, 2)}\n`,
  );
}

export async function readResult(scenario: string): Promise<ScenarioResult | undefined> {
  try {
    return JSON.parse(
      await readFile(resolve(RESULTS_DIR, `${scenario}.json`), 'utf8'),
    ) as ScenarioResult;
  } catch {
    return undefined;
  }
}

const n = (value: number | undefined, digits = 0): string =>
  value === undefined ? '-' : value.toLocaleString('en-US', { maximumFractionDigits: digits });

const COLUMNS = [
  'Scenario',
  'Ingest acked ev/s',
  'Rate-limited ev',
  'Clients (conn/req)',
  'Msgs/s out',
  'MB/s out',
  'E2E p50 / p95 / p99 ms',
  'Ack p99 ms',
  'Server CPU % (mean/max)',
  'RSS MB',
  'Loop p99 ms (max)',
  'Dropped',
];

function row(r: ScenarioResult): string[] {
  const lat = r.clients?.latency.all;
  return [
    `${r.scenario} ${r.title}`,
    r.ingest ? `${n(r.ingest.ackedEventsPerSec)} of ${n(r.ingest.offeredEventsPerSec)}` : '-',
    n(r.server.rateLimited),
    r.connect ? `${n(r.connect.connected)}/${n(r.connect.requested)}` : '-',
    n(r.clients?.messagesPerSec),
    r.clients ? n(r.clients.bytesPerSec / 1e6, 2) : '-',
    lat ? `${n(lat.p50Ms, 1)} / ${n(lat.p95Ms, 1)} / ${n(lat.p99Ms, 1)}` : '-',
    r.ingest ? n(r.ingest.ackLatency.p99Ms, 1) : '-',
    `${n(r.server.cpuPct.mean)} / ${n(r.server.cpuPct.max)}`,
    n(r.server.rssMb.max),
    n(r.server.eventLoopP99Ms.max, 1),
    n(r.server.dropped),
  ];
}

export function markdownTable(results: ScenarioResult[]): string {
  const lines = [`| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`];
  for (const result of results) lines.push(`| ${row(result).join(' | ')} |`);
  return lines.join('\n');
}
