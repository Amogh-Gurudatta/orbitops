# API reference

OrbitOps exposes a JSON REST API under `/api/v1` and three Socket.IO namespaces: `/ingest` for telemetry
producers, `/telemetry` for live updates to browsers, and `/alerts` for live alerts. This document lists every
endpoint and event with its inputs, outputs and error codes, as implemented. Design background is in
[REALTIME.md](REALTIME.md); the security model is in [SECURITY.md](SECURITY.md).

Sources: routes in [http/routes](../packages/server/src/http/routes), socket handlers in
[ws](../packages/server/src/ws), and contracts in [packages/shared/src](../packages/shared/src).

## REST conventions

- Base path `/api/v1`. Bodies and responses are JSON. Request bodies are limited to 256 KiB.
- Authentication is by httpOnly cookie (`oo_at`, access token, 15 minutes). A `Authorization: Bearer <access
token>` header is also accepted. Every endpoint except `/auth/login`, `/auth/refresh` and `/auth/logout`
  requires a valid access token.
- Roles are `viewer`, `operator` and `admin`. The "Role" column shows the minimum role; "operator" means
  operator or admin. See the [role matrix](SECURITY.md#role-matrix).
- Query strings are validated with strict schemas: an unknown parameter is a `400`.
- Times in requests (`from`, `to`, `before`) accept epoch milliseconds or an ISO-8601 string with offset.
  Times in responses are epoch milliseconds.
- Satellite ids are NORAD catalogue numbers (non-negative integers).
- All `/api/v1` calls share a limit of 300 requests per minute per client IP, answered with `429
{"error":"rate_limited"}`. Standard `RateLimit` headers (draft-8) are sent.

### Errors

Every error is `{ "error": "<code>", "details"?: ... }`.

| Status | `error`                                                                                                                            | When                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_failed`                                                                                                                | Body, params or query failed schema validation; `details` is a zod flattened error (`formErrors`, `fieldErrors`) |
| 400    | `invalid_range`                                                                                                                    | `from` is not before `to`                                                                                        |
| 400    | `range_too_large`                                                                                                                  | Time range exceeds the endpoint's maximum                                                                        |
| 400    | `unsupported_metrics`                                                                                                              | Metric not available from the chosen source; `details` has `source` and `metrics`                                |
| 400    | `too_many_buckets`                                                                                                                 | Heatmap would exceed 2000 columns                                                                                |
| 400    | `bad_request`                                                                                                                      | Malformed JSON                                                                                                   |
| 401    | `unauthenticated`                                                                                                                  | Missing, expired or invalid access token                                                                         |
| 401    | `invalid_credentials`                                                                                                              | Wrong e-mail or password                                                                                         |
| 403    | `forbidden`                                                                                                                        | Authenticated but the role is not allowed                                                                        |
| 404    | `not_found`, `satellite_not_found`, `station_not_found`, `alert_not_found`, `rule_not_found`, `user_not_found`, `device_not_found` | Unknown resource or API path                                                                                     |
| 409    | `email_taken`                                                                                                                      | Creating a user with an existing e-mail                                                                          |
| 413    | `payload_too_large`                                                                                                                | Body over 256 KiB                                                                                                |
| 429    | `rate_limited`, `too_many_attempts`                                                                                                | General or login rate limit                                                                                      |
| 500    | `internal_error`                                                                                                                   | Unexpected failure (details are logged, not returned)                                                            |

## Auth

[routes/auth.ts](../packages/server/src/http/routes/auth.ts)

| Method | Path                 | Role | Body / notes                   | Success                                                                                                                    | Errors                                                                        |
| ------ | -------------------- | ---- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/auth/login`        | none | `{ email, password }` (strict) | `200 { user }` and sets `oo_at` (path `/`, 15 min) and `oo_rt` (path `/api/v1/auth`, 7 days) cookies                       | 400, 401 `invalid_credentials`, 429 `too_many_attempts` (5 per minute per IP) |
| POST   | `/auth/refresh`      | none | Uses the `oo_rt` cookie        | `200 { user }`, new cookies. The user is reloaded from the database, so role changes and deleted accounts take effect here | 401 `unauthenticated` (cookies cleared)                                       |
| POST   | `/auth/logout`       | none | -                              | `204`, cookies cleared                                                                                                     | -                                                                             |
| GET    | `/auth/me`           | any  | -                              | `200 { user }`                                                                                                             | 401                                                                           |
| GET    | `/auth/socket-token` | any  | -                              | `200 { token }`, a 60-second JWT for socket clients that cannot send cookies                                               | 401                                                                           |

`user` is `{ id, email, name, role }`.

## Fleet

| Method | Path                 | Role | Parameters                                                            | Success                                                                    |
| ------ | -------------------- | ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/satellites`        | any  | -                                                                     | `{ satellites: [{ satId, name, group, line1, line2, epoch, status }] }`    |
| GET    | `/satellites/:satId` | any  | path `satId`                                                          | `{ satellite, latest }` where `latest` is a compact snapshot or `null`     |
| GET    | `/ground-stations`   | any  | -                                                                     | `{ stations: [{ id, name, network, lat, lon, altKm, minElevDeg }] }`       |
| GET    | `/passes`            | any  | `satId` (required), `stationId` (optional), `hours` 1-48 (default 12) | `{ passes: [{ satId, stationId, aos, los, maxElevDeg }] }` sorted by `aos` |

`status` is one of `NOMINAL`, `CAUTION`, `WARNING`, `STALE`. `STALE` means no sample for 15 seconds (server
clock) or none since boot; otherwise it is the worst severity among open or acknowledged alerts. `epoch` is the
TLE epoch in milliseconds.

`/passes` propagates the TLE with SGP4. Results are cached per satellite, station, hour and horizon, and the
handler yields to the event loop between stations. Errors: 404 `satellite_not_found`, `station_not_found`.

## Telemetry history

[routes/telemetry.ts](../packages/server/src/http/routes/telemetry.ts)

`GET /telemetry` returns aligned columns (one shared time axis, one array per metric), ready for uPlot.

| Parameter    | Required | Default     | Notes                                                            |
| ------------ | -------- | ----------- | ---------------------------------------------------------------- |
| `satId`      | yes      |             |                                                                  |
| `metrics`    | yes      |             | Comma-separated, 1 to 12 names                                   |
| `from`, `to` | no       | last 1 hour | Maximum span 31 days                                             |
| `maxPoints`  | no       | 1000        | 10 to 5000; the response is downsampled with LTTB                |
| `bands`      | no       | `0`         | `1` adds `<metric>:min` and `<metric>:max` series (rollups only) |

The source is chosen by range. A span of 2 hours or less reads raw `telemetry`; a longer span reads
`telemetry_1m` rollups.

| Source   | Allowed `metrics`                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raw`    | `lat`, `lon`, `altKm`, `velKms`, `shadow`, `solarW`, `batSoc`, `batV`, `busA`, `panelTempC`, `obcTempC`, `rssiDbm`, `snrDb`, `elevDeg`, `attRateDps`, `propKg` |
| `rollup` | `batSoc`, `batV`, `busA`, `solarW`, `panelTempC`, `obcTempC`, `rssiDbm`, `snrDb`, `attRateDps`, `altKm`, `eclipseFrac`                                         |

Response:

```json
{
  "satId": 25544,
  "source": "raw",
  "t": [1763199600000, 1763199600500],
  "series": { "batSoc": [0.874, 0.875], "panelTempC": [52.4, null] },
  "lastSeq": 17640002731,
  "serverTime": 1763199660123
}
```

`lastSeq` is the highest `seq` among all stored points in the range (taken before downsampling, so it is exact),
or `-1` if the range is empty. The client uses it as the live/history watermark; see
[REALTIME.md](REALTIME.md#history-and-live-merge). `null` entries mean no value at that time.

Errors: 400 `validation_failed`, `invalid_range`, `range_too_large`, `unsupported_metrics`; 404
`satellite_not_found`.

`GET /telemetry/latest` (any role) returns `{ snapshots: TmSnapshot[] }`, the in-memory latest frame of every
satellite in compact form (see [delta keys](#compact-delta-keys)).

## Alerts

[routes/alerts.ts](../packages/server/src/http/routes/alerts.ts), [routes/alertRules.ts](../packages/server/src/http/routes/alertRules.ts)

| Method | Path                  | Role     | Parameters / body                                                                                                                | Success                            |
| ------ | --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| GET    | `/alerts`             | any      | `state` (`open` `acked` `resolved`), `severity` (`WARNING` `CAUTION` `ADVISORY`), `satId`, `limit` 1-500 (default 100), `before` | `{ alerts: Alert[] }` newest first |
| POST   | `/alerts/:id/ack`     | operator | -                                                                                                                                | `{ alert }`                        |
| POST   | `/alerts/:id/resolve` | operator | -                                                                                                                                | `{ alert }`                        |
| GET    | `/alert-rules`        | any      | -                                                                                                                                | `{ rules: AlertRule[] }`           |
| PUT    | `/alert-rules/:id`    | admin    | Any non-empty subset of `threshold`, `severity`, `enabled`, `samples`, `clearRatio`, `windowSize`                                | `{ rule }`                         |

Pagination is by cursor: pass the last row's `openedAt` as `before` to get the next page.

Ack and resolve are idempotent: an alert already past the requested step is returned unchanged. `ack` only
applies to `open` alerts; `resolve` applies to `open` and `acked`. Both push an `alert:update` event to
subscribers. Updating a rule reloads the rules into the running anomaly engine immediately. Errors: 404
`alert_not_found`, `rule_not_found`.

An `Alert` is:

```json
{
  "id": "6738...",
  "key": "25544:tcs.panelOverTemp",
  "satId": 25544,
  "ruleId": "tcs.panelOverTemp",
  "subsystem": "TCS",
  "severity": "CAUTION",
  "state": "open",
  "message": "Solar panel at 72.4 °C (limit 70 °C)",
  "value": 72.4,
  "threshold": 70,
  "openedAt": 1763199600000,
  "lastSeenAt": 1763199612000,
  "count": 14
}
```

`ackedBy`, `ackedAt` and `resolvedAt` appear once set.

## Commands

[routes/commands.ts](../packages/server/src/http/routes/commands.ts)

| Method | Path        | Role     | Body / parameters                                                                                                                                                                | Success                     |
| ------ | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| POST   | `/commands` | operator | `{ satId, kind, fault? }`; `kind` is `inject_fault`, `clear_fault`, `safe_mode` or `nominal_mode`; `fault` (`battery` `thermal` `tumble` `comms`) is required for `inject_fault` | `202 { command }`           |
| GET    | `/commands` | any      | `satId` (optional), `limit` 1-100 (default 100)                                                                                                                                  | `{ commands }` newest first |

`command` is `{ id, satId, kind, fault?, issuedBy, issuedAt, status }`. `status` is `sent` when at least one
simulator device is connected (the command is audited, then relayed on the `/ingest` socket) and `no_device`
otherwise (audited only). `clear_fault` without `fault` clears every active fault. Errors: 400, 404
`satellite_not_found`.

## Analytics

[routes/analytics.ts](../packages/server/src/http/routes/analytics.ts). Both endpoints read the minute rollups
and accept ranges of at most 7 days.

| Method | Path                 | Parameters                                                                                                          | Success                                                                                                                                                       |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/analytics/heatmap` | `metric` (a rollup metric, default `panelTempC`), `from`, `to` (default last hour), `bucketMin` 1-1440 (default 10) | `{ satIds, buckets, values }`: `values[row][col]` is the mean of the metric, `null` for gaps; rows ordered by group then id; `buckets` are bucket start times |
| GET    | `/analytics/summary` | `satId` (required), `from`, `to` (default last 24 h)                                                                | `{ metrics, eclipseFrac, alertCount, baseline }`                                                                                                              |

`metrics` maps each rollup metric to `{ min, max, avg }`. `baseline` is the same-length window one day earlier,
shifted forward 24 hours so it overlays the requested range, as `{ [metric]: { t, avg, min, max } }` arrays of
about 500 points. Errors: `invalid_range`, `range_too_large`, `too_many_buckets` (heatmap), 404
`satellite_not_found` (summary).

## System, admin and operations

| Method | Path            | Role  | Notes                                                                                                                                                  |
| ------ | --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/system/stats` | any   | The latest `PipelineStats` snapshot (same object as the socket `stats` event, see below)                                                               |
| GET    | `/system/chaos` | any   | `{ chaos }`, the current chaos configuration                                                                                                           |
| PUT    | `/system/chaos` | admin | Body `{ enabled, duplicateRate, reorderRate, malformedRate }`, each rate a probability 0 to 1; returns `{ chaos }` and pushes it to connected devices  |
| GET    | `/users`        | admin | `{ users: [{ id, email, name, role }] }`                                                                                                               |
| POST   | `/users`        | admin | `{ email, name, password (8-256 chars), role (default viewer) }` returns `201 { user }`; 409 `email_taken`                                             |
| PATCH  | `/users/:id`    | admin | `{ role }`; an admin cannot change their own role (400 `cannot_change_own_role`)                                                                       |
| GET    | `/devices`      | admin | `{ devices: [{ id, name, allowedSources, lastSeenAt?, createdAt? }] }` (never the key)                                                                 |
| POST   | `/devices`      | admin | `{ name, allowedSources? (default ["*"]) }` returns `201 { device, key }`. The plaintext `key` (`oo_dev_...`) is shown once; only its sha256 is stored |
| DELETE | `/devices/:id`  | admin | `204`; 404 `device_not_found`                                                                                                                          |

Outside `/api/v1` (no authentication, not rate limited by the API limiter):

| Method | Path       | Notes                                                                                                |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/healthz` | `200 { status: "ok", uptimeS }` when MongoDB is connected, otherwise `503 { status: "unavailable" }` |
| GET    | `/metrics` | Prometheus text exposition (`orbitops_*` counters and gauges plus Node defaults)                     |

`PipelineStats`:

```json
{
  "ts": 1763199660000,
  "uptimeS": 3600,
  "ingest": {
    "eventsPerSec": 128,
    "accepted": 460800,
    "duplicates": 0,
    "outOfOrder": 0,
    "late": 0,
    "malformed": 0,
    "rateLimited": 0,
    "dropped": 0
  },
  "broadcast": { "msgsPerSec": 41, "bytesPerSec": 9800, "slowConsumers": 0 },
  "store": { "queueDepth": 12, "flushMsP50": 8.2, "flushMsP99": 31.5, "persisted": 230000 },
  "clients": { "telemetry": 3, "alerts": 3, "ingest": 1 },
  "eventLoop": { "p50Ms": 0.4, "p99Ms": 3.1 },
  "latency": { "p50": 18.5, "p95": 41.0, "p99": 63.2 },
  "memory": { "rssMb": 182.4, "heapMb": 96.1 }
}
```

## Socket.IO

All namespaces use the shared MessagePack parser ([socketParser.ts](../packages/shared/src/socketParser.ts)).
Server and every client must pass `{ parser: socketParser }`, otherwise packets cannot be decoded. Event names
and namespaces are constants in [constants.ts](../packages/shared/src/constants.ts).

The server accepts `websocket` and `polling` transports, limits a single message to 256 KiB, and enables
[connection state recovery](REALTIME.md#connection-state-recovery) for up to 2 minutes.

### Authentication

| Namespace               | Who             | Credential                                                                                                                                                  |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/telemetry`, `/alerts` | Users, any role | Browser: the `oo_at` cookie is sent with the handshake. Other clients: `auth: { token }` with a socket token from `/auth/socket-token` (or an access token) |
| `/ingest`               | Devices         | `auth: { apiKey }`; the key is hashed and looked up, compared in constant time                                                                              |

A failed handshake is refused with the connect error `unauthorized`.

### `/ingest` (device to server)

| Event   | Direction        | Payload                                                                                                                  | Ack                                                               |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `batch` | device to server | `{ sourceId, events: [{ seq, ts, type: "tm", data }] }`, 1 to 500 events                                                 | `IngestAck` (required: a call without an ack callback is ignored) |
| `cmd`   | server to device | `Command` plus optional `id` and `issuedBy`; relayed to every connected device, which ignores satellites it does not own | none                                                              |
| `chaos` | server to device | `ChaosConfig`; sent on connect and whenever an admin changes it                                                          | none                                                              |

`sourceId` must match `sat-<digits>` and the device's `allowedSources` must include it (or `*`). `seq` is a
non-negative integer, `ts` an integer epoch-millisecond timestamp, `data` the full telemetry frame (strict:
unknown or missing fields are rejected). Each event is validated on its own, so one bad event does not discard
the batch; events stamped more than 5 s in the future or more than 1 h in the past count as malformed.

`IngestAck`:

| Situation                               | Ack                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Processed                               | `{ ok: true, accepted, duplicates, rejected }`; `rejected` counts malformed events in the batch |
| Processed, write queue over 80 % full   | as above plus `retryAfterMs: 250`                                                               |
| Envelope invalid                        | `{ ok: false, accepted: 0, duplicates: 0, rejected: 1 }`                                        |
| Source not allowed or satellite unknown | `{ ok: false, accepted: 0, duplicates: 0, rejected: <batch size> }`                             |
| Device rate limit hit                   | `{ ok: false, accepted: 0, duplicates: 0, rejected: 0, retryAfterMs }`                          |
| Internal error                          | `{ ok: false, ..., retryAfterMs: 1000 }`                                                        |

### `/telemetry` (server to browser)

| Event   | Direction        | Payload                                                        | Notes                                                                                                                                |
| ------- | ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `sub`   | client to server | `{ rooms: string[], hz?: number }` where `hz` is 1, 2, 5 or 10 | Ack: `{ ok: true, rooms }` (all rooms now joined) or `{ ok: false, error }`                                                          |
| `unsub` | client to server | `{ rooms: string[] }`                                          | Same ack shape                                                                                                                       |
| `snap`  | server to client | `TmSnapshot[]`                                                 | Sent after `sub` (and after a recovered connection) for the subscribed `fleet`, `group:*` and `sat:*` rooms; one entry per satellite |
| `tm`    | server to client | `TmDelta[]`                                                    | Batched per tick, volatile (may be dropped)                                                                                          |
| `stats` | server to client | `PipelineStats`                                                | To the `system` room once per second; also once immediately on subscribing                                                           |
| `kick`  | server to client | `{ reason: "slow_consumer" }`                                  | Sent just before the server disconnects a client that stayed too slow                                                                |
| `time`  | client to server | any value; ack receives the server's `Date.now()`              | For clock-offset estimation                                                                                                          |
| `lat`   | client to server | `{ p50, p95, p99, n }` in milliseconds                         | Client-measured latency report, strict and range checked                                                                             |

`sub` errors:

| `error`           | Meaning                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `invalid_request` | Payload does not match the schema (rooms 1-64 chars each, at most 50; `hz` not one of 1, 2, 5, 10) |
| `invalid_room`    | A room name is malformed or not allowed in this namespace                                          |
| `too_many_rooms`  | The client would exceed 50 rooms                                                                   |
| `rate_limited`    | More than 20 subscription changes in 10 seconds                                                    |

`hz` is a per-connection setting: it applies to all of the client's `sat:*` rooms, and the most recent `sub`
carrying an `hz` wins. Without it the connection is served at 10 Hz.

### `/alerts`

| Event          | Direction        | Payload                | Notes                                                         |
| -------------- | ---------------- | ---------------------- | ------------------------------------------------------------- |
| `sub`, `unsub` | client to server | as above (alert rooms) | Same acks and errors; `hz` is accepted but unused             |
| `alert`        | server to client | `Alert`                | A new alert opened. Reliable (not volatile)                   |
| `alert:update` | server to client | `Alert`                | Count, value, acknowledgement or resolution changed. Reliable |

### Rooms

| Room                    | Namespace    | Content and rate                                                                                                                                          |
| ----------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sat:<satId>`           | `/telemetry` | Every changed field of one satellite, every 100 ms tick (10 Hz), or merged and sent at the connection's `hz` of 1, 2 or 5                                 |
| `group:<name>`          | `/telemetry` | All fields that changed for satellites in the group, merged, 2 Hz. Names: `stations`, `weather`, `comms`, `earth-obs`, `navigation`, `science`, `amateur` |
| `fleet`                 | `/telemetry` | Position and status only (`lat`, `lon`, `altKm`, `batSoc`, `mode`, `shadow`) for all satellites, merged, 1 Hz                                             |
| `system`                | `/telemetry` | `PipelineStats` once per second                                                                                                                           |
| `alerts:all`            | `/alerts`    | Every alert event                                                                                                                                         |
| `alerts:sev:<severity>` | `/alerts`    | Alert events of one severity (`WARNING`, `CAUTION` or `ADVISORY`)                                                                                         |
| `alerts:sat:<satId>`    | `/alerts`    | Alert events of one satellite                                                                                                                             |

Room names are parsed strictly by [parseRoom](../packages/shared/src/rooms.ts); anything else is
`invalid_room`. Any authenticated role may join any room in its namespace; roles gate REST actions, not
subscriptions.

### Compact delta keys

Live telemetry uses short keys. `TmDelta` is `{ s: satId, q: seq, t: timestamp ms, d: { <short key>: value } }`
and contains only fields that changed after rounding. `TmSnapshot` has the same shape but `d` holds every field.
Values are rounded to the precision below before they are compared or sent
([codec.ts](../packages/shared/src/codec.ts)).

| Short key | Field    | Decimals | Short key | Field        | Decimals |
| --------- | -------- | -------- | --------- | ------------ | -------- |
| `a`       | `lat`    | 4        | `i`       | `busA`       | 2        |
| `o`       | `lon`    | 4        | `tp`      | `panelTempC` | 1        |
| `h`       | `altKm`  | 1        | `to`      | `obcTempC`   | 1        |
| `v`       | `velKms` | 3        | `r`       | `rssiDbm`    | 1        |
| `sh`      | `shadow` | 2        | `n`       | `snrDb`      | 1        |
| `sw`      | `solarW` | 1        | `st`      | `stationId`  | (string) |
| `b`       | `batSoc` | 3        | `e`       | `elevDeg`    | 1        |
| `bv`      | `batV`   | 2        | `ar`      | `attRateDps` | 2        |
| `pk`      | `propKg` | 2        | `m`       | `mode`       | (string) |

`null` is a valid value (for example `r: null` when a station goes out of view), distinct from an absent key,
which means "unchanged".

Example delta, as decoded by the client:

```json
[
  {
    "s": 25544,
    "q": 17640002731,
    "t": 1763199600300,
    "d": { "a": 41.8272, "o": -73.4091, "b": 0.874, "r": -104.2 }
  }
]
```

### Chaos and commands over sockets

- `chaos`: the server pushes the current `ChaosConfig` to every `/ingest` device on connect and after each
  `PUT /system/chaos`. The simulator then deliberately duplicates, reorders and corrupts events at the
  configured rates. See [SIMULATION.md](SIMULATION.md#chaos-mode).
- `cmd`: a `Command` relayed from `POST /commands`.
- `kick`: see [backpressure](REALTIME.md#backpressure-and-slow-consumers).
