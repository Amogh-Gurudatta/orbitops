// Messages exchanged between the swarm coordinator (main thread) and its worker threads.
import type { HistogramSnapshot } from './histogram.js';

export type ClientKind = 'fleet' | 'group' | 'sat' | 'stalled';
export const MEASURED_KINDS = ['fleet', 'group', 'sat'] as const;

export interface ClientSpec {
  kind: ClientKind;
  rooms: string[];
  /** Requested per-subscription rate; omitted means the server default. */
  hz?: number;
}

export interface WorkerConfig {
  url: string;
  token: string;
}

export type ToWorker =
  | { id: number; type: 'connect'; specs: ClientSpec[]; rampPerSec: number }
  | { id: number; type: 'reset' }
  | { id: number; type: 'collect' }
  | { id: number; type: 'resumeStalled' }
  | { id: number; type: 'close' };

export interface ConnectReply {
  connected: number;
  failed: number;
  /** First few distinct failure messages, for diagnosis. */
  errors: string[];
}

export interface HistogramPayload {
  buckets: HistogramSnapshot;
  sum: number;
  max: number;
}

export interface CollectReply {
  messages: number;
  deltas: number;
  bytes: number;
  connectedNow: number;
  disconnects: Record<string, number>;
  kicks: number;
  /** Disconnect/kick bookkeeping for clients that were deliberately stalled. */
  stalled: { count: number; kicks: number; disconnects: Record<string, number> };
  latency: Record<(typeof MEASURED_KINDS)[number], HistogramPayload>;
  loopP99Ms: number;
}

export type FromWorker =
  | { id: number; type: 'connected'; reply: ConnectReply }
  | { id: number; type: 'collected'; reply: CollectReply }
  | { id: number; type: 'done' };
