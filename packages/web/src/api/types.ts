// Response shapes for the REST API (/api/v1). Event/contract types come from @orbitops/shared.
import type {
  Alert,
  AlertRule,
  ChaosConfig,
  Command,
  Role,
  SatGroup,
  TmSnapshot,
} from '@orbitops/shared';
import type { PipelineStats } from '../realtime/protocol.ts';

export type { PipelineStats };

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type ServerSatStatus = 'NOMINAL' | 'CAUTION' | 'WARNING' | 'STALE';

export interface Satellite {
  satId: number;
  name: string;
  group: SatGroup;
  line1: string;
  line2: string;
  epoch: string;
  status: ServerSatStatus;
}

export interface GroundStation {
  id: string;
  name: string;
  network: string;
  lat: number;
  lon: number;
  altKm: number;
  minElevDeg: number;
}

export interface Pass {
  satId: number;
  stationId: string;
  /** Epoch ms. */
  aos: number;
  los: number;
  maxElevDeg: number;
}

/** Columnar history for uPlot. `lastSeq` is the live/history dedup watermark. */
export interface TelemetryHistory {
  satId: number;
  source: 'raw' | 'rollup';
  /** Epoch ms. */
  t: number[];
  series: Record<string, (number | null)[]>;
  lastSeq: number;
  serverTime: number;
}

export interface CommandRecord extends Command {
  id: string;
  issuedBy: string;
  issuedAt: number;
  status: string;
}

export interface Heatmap {
  satIds: number[];
  buckets: number[];
  values: (number | null)[][];
}

export interface AnalyticsSummary {
  metrics: Record<string, { min: number; max: number; avg: number }>;
  eclipseFrac: number;
  alertCount: number;
  baseline: Record<string, { t: number[]; avg: number[]; min: number[]; max: number[] }>;
}

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt?: string;
}

export interface Device {
  id: string;
  name: string;
  sourceId: string;
  createdAt?: string;
  lastSeenAt?: string;
  /** Present only in the POST /devices response. */
  key?: string;
}

export type { Alert, AlertRule, ChaosConfig, TmSnapshot };
