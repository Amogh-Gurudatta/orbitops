// Limits, tunables, namespaces, event names, roles and fleet taxonomy shared by every package.

// --- Ingest pipeline ---------------------------------------------------------
export const INGEST_BATCH_INTERVAL_MS = 100;
export const MAX_EVENTS_PER_BATCH = 500;
/** Events stamped further ahead of server time than this are rejected. */
export const MAX_FUTURE_SKEW_MS = 5_000;
/** Events older than this are rejected (one hour). */
export const MAX_PAST_AGE_MS = 3_600_000;
/** Per-source window of recently seen seq numbers used for duplicate detection. */
export const DEDUP_WINDOW = 1024;
export const REORDER_HOLD_MS = 250;
export const REORDER_MAX_EVENTS = 64;

// --- Broadcast ---------------------------------------------------------------
export const BROADCAST_HZ = 10;
export const GROUP_HZ = 2;
export const FLEET_HZ = 1;
/** Rates a client may request for its subscriptions. */
export const ALLOWED_SUB_HZ = [1, 2, 5, 10] as const;
export const MAX_ROOMS_PER_CLIENT = 50;

// --- Socket.IO namespaces ----------------------------------------------------
export const NS_INGEST = '/ingest';
export const NS_TELEMETRY = '/telemetry';
export const NS_ALERTS = '/alerts';

// --- Socket.IO event names (client <-> server) -------------------------------
export const INGEST_BATCH = 'batch';
export const SUB = 'sub';
export const UNSUB = 'unsub';
export const TM_DELTA = 'tm';
export const TM_SNAPSHOT = 'snap';
export const ALERT = 'alert';
export const ALERT_UPDATE = 'alert:update';
export const TIME_SYNC = 'time';
export const LATENCY_REPORT = 'lat';
export const COMMAND = 'cmd';
export const SERVER_STATS = 'stats';

// --- Roles -------------------------------------------------------------------
export const ROLES = ['viewer', 'operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

// --- Spacecraft taxonomy -----------------------------------------------------
export const SUBSYSTEMS = ['EPS', 'TCS', 'COMM', 'ADCS', 'PROP', 'OBC'] as const;
export type Subsystem = (typeof SUBSYSTEMS)[number];

/** Fleet groupings used for the `group:{name}` rooms and UI filters. */
export const SAT_GROUPS = [
  'stations',
  'weather',
  'comms',
  'earth-obs',
  'navigation',
  'science',
  'amateur',
] as const;
export type SatGroup = (typeof SAT_GROUPS)[number];
