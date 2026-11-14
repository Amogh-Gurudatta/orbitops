// Client-side constants: API base, mission epoch and realtime tunables.

export const API_BASE = '/api/v1';

/** Platform epoch: MET (mission elapsed time) counts up from here. */
export const MISSION_EPOCH_MS = Date.UTC(2026, 10, 1, 0, 0, 0);

/** Samples kept per satellite in the live ring buffer (~5 min at 10 Hz). */
export const LIVE_BUFFER_SAMPLES = 3000;

/** A satellite with no frame for this long is classified STALE. */
export const STALE_AFTER_MS = 15_000;

/** The store publishes status classification changes to React at most this often. */
export const STATUS_PUBLISH_INTERVAL_MS = 500;

/** The worker posts at most one telemetry batch per this interval. */
export const WORKER_BATCH_INTERVAL_MS = 50;

export const TIME_SYNC_INTERVAL_MS = 10_000;
export const LATENCY_REPORT_INTERVAL_MS = 5_000;
export const LATENCY_WINDOW_SAMPLES = 2000;

export const ALERT_LIST_CAP = 500;
