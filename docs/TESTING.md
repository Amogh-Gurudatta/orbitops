# Testing

OrbitOps has automated unit and integration tests for every package, run by Vitest, plus a repeatable set of
manual checks for the behaviour that is best seen live: roles, fault injection and chaos mode. A GitHub Actions
workflow runs lint, typecheck, tests and the web build on every push and pull request. Load testing has its own
document: [PERFORMANCE.md](PERFORMANCE.md).

## Running the tests

From the repository root:

| Command                           | What it runs                                                            |
| --------------------------------- | ----------------------------------------------------------------------- |
| `npm test`                        | Every workspace's tests, one after another                              |
| `npm test -w @orbitops/shared`    | Shared contracts, codec, rooms, parser, LTTB                            |
| `npm test -w @orbitops/server`    | Server unit tests and the integration tests                             |
| `npm test -w @orbitops/simulator` | Simulator                                                               |
| `npm test -w @orbitops/web`       | Client real-time layer and feature logic (Node environment, no browser) |
| `npm run lint`                    | ESLint (flat config) over the whole repo                                |
| `npm run typecheck`               | `tsc --noEmit` in every workspace (strict mode)                         |
| `npx prettier --check .`          | Formatting                                                              |

For a single file or test name, run Vitest in the package, for example
`cd packages/server && npx vitest run src/ingest/pipeline.test.ts` or `npx vitest -t "dedup contract"`.

Test counts at the time of writing (from `vitest run`): shared 71, server 144 (of which 24 are integration
tests), simulator 30. The web package's count grows as features land; run `npm test -w @orbitops/web` for the
current figure.

## What each suite covers

### `@orbitops/shared`

| File                                                                | Covers                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [telemetry.test.ts](../packages/shared/src/telemetry.test.ts)       | Frame and event schemas: range checks, `NaN` and `Infinity` rejection, nullable link fields, strict objects (extra or missing keys), negative `seq` and fractional `ts`, source-id format, batch size limits |
| [codec.test.ts](../packages/shared/src/codec.test.ts)               | Unique wire keys, per-field rounding, full and partial round trips, nulls preserved, unknown keys ignored, deltas that ignore sub-precision jitter                                                           |
| [rooms.test.ts](../packages/shared/src/rooms.test.ts)               | Room grammar: valid and invalid names, subscribe request limits                                                                                                                                              |
| [socketParser.test.ts](../packages/shared/src/socketParser.test.ts) | MessagePack framing round trip for every packet type (including binary and ack ids), and rejection of about twenty kinds of malformed packet                                                                 |
| [lttb.test.ts](../packages/shared/src/lttb.test.ts)                 | Downsampling keeps endpoints and peaks, handles small inputs                                                                                                                                                 |

### `@orbitops/server`

| Area                | Files                                                                                                                                                                                                                                                                                                | Covers                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingest pipeline     | [validate](../packages/server/src/ingest/validate.test.ts), [rateLimit](../packages/server/src/ingest/rateLimit.test.ts), [dedup](../packages/server/src/ingest/dedup.test.ts), [reorder](../packages/server/src/ingest/reorder.test.ts), [pipeline](../packages/server/src/ingest/pipeline.test.ts) | Envelope and per-event validation, time window, token bucket and burst, duplicate window, reordering and gap skipping, late events, source isolation, restarted sources, `retryAfterMs` backpressure, unauthorised sources |
| State and anomalies | [state/store](../packages/server/src/state/store.test.ts), [anomaly/*](../packages/server/src/anomaly)                                                                                                                                                                                               | Dirty-field tracking and snapshots; Welford statistics, threshold, z-score and rate-of-change detectors, hysteresis, cooldown, stale rules, rule hot reload, determinism                                                   |
| Storage             | [writer](../packages/server/src/store/writer.test.ts), [history](../packages/server/src/store/history.test.ts), [rollups](../packages/server/src/jobs/rollups.test.ts)                                                                                                                               | `PERSIST_HZ` downsampling, document shape, late samples, boot marks, shedding when the queue is full, failed inserts; column downsampling that keeps spikes; rollup pipeline, idempotent upserts, backfill and resume      |
| WebSocket layer     | [ws/backpressure](../packages/server/src/ws/backpressure.test.ts), [ws/subscriptions](../packages/server/src/ws/subscriptions.test.ts)                                                                                                                                                               | Slow-consumer decisions (downgrade, recover, kick), subscription rate window, delta coalescing, fleet field restriction                                                                                                    |
| Auth and config     | [auth](../packages/server/src/auth/auth.test.ts), [config](../packages/server/src/config.test.ts)                                                                                                                                                                                                    | Token use separation and tampering, argon2id hashing, device-key lookup and allow-lists, cookie parsing, production config rules                                                                                           |
| Other               | [metrics/collector](../packages/server/src/metrics/collector.test.ts), [orbit/passes](../packages/server/src/orbit/passes.test.ts)                                                                                                                                                                   | Rates, percentiles and latency weighting; pass prediction for the ISS                                                                                                                                                      |
| Integration         | [server.integration](../packages/server/src/server.integration.test.ts), [api.integration](../packages/server/src/api.integration.test.ts)                                                                                                                                                           | See below                                                                                                                                                                                                                  |

### `@orbitops/simulator`

| File                                                                                                                     | Covers                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [orbit.test.ts](../packages/simulator/src/orbit.test.ts)                                                                 | ISS altitude, latitude and speed over a day, `null` instead of an exception when SGP4 fails, sun and eclipse alternation (roughly a third of an orbit in shadow), look angles, station visibility                                         |
| [agent.test.ts](../packages/simulator/src/agent.test.ts)                                                                 | Schema-valid events with increasing `seq` over two hours for five satellites, clock-based first `seq`, battery drain in eclipse and recharge in sun, battery, thermal, tumble and comms faults and their clearing, safe mode, determinism |
| [chaos.test.ts](../packages/simulator/src/chaos.test.ts)                                                                 | Duplicates, reordering and malformed events are injected at the configured rates and never mutate the clean copy                                                                                                                          |
| [transport.test.ts](../packages/simulator/src/transport.test.ts)                                                         | Per-source batches over the MessagePack parser with the API key, pause on `retryAfterMs` without affecting other sources, retry after an ack timeout, bounded buffer with counted drops, validated `COMMAND` and chaos configuration      |
| [catalog.test.ts](../packages/simulator/src/catalog.test.ts), [config.test.ts](../packages/simulator/src/config.test.ts) | Snapshot loading, sharding and `SIM_SATS` selection, TLE refresh parsing and failure handling, configuration parsing                                                                                                                      |

### `@orbitops/web`

Tests run in Node with no DOM, which is possible because the real-time layer is written as pure modules.

| Area              | Files (in [src/realtime](../packages/web/src/realtime))                                                   | Covers                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-time core    | `aggregator`, `seqTracker`, `ringBuffer`, `frameLoop`, `subscriptionManager`, `telemetryStore`, `latency` | Delta merging, duplicate and watermark dropping, producer-restart detection, ring-buffer wrap-around and zero-copy views, frame-loop rate caps, ref-counted subscriptions, history and live assembly, NTP-style offset and percentiles |
| Status and alerts | `status`, `alertSummary`                                                                                  | STALE and severity classification, alert summaries                                                                                                                                                                                     |
| Feature logic     | Files under [src/features](../packages/web/src/features)                                                  | Pure helpers for the alerts, analytics, globe, satellite and system views                                                                                                                                                              |

The Playwright browser smoke test mentioned in the project plan is not part of the repository.

## Integration test infrastructure

The two integration files start a **real server** (HTTP, Socket.IO, pipeline, writer, rollups, alert manager)
on an ephemeral port against a **real MongoDB replica set**, then drive it with real HTTP requests and
Socket.IO clients using the shared parser. The harness is
[testing/harness.ts](../packages/server/src/testing/harness.ts).

- **MongoDB source.** If `TEST_MONGODB_URI` is set (for example the Docker Compose MongoDB:
  `TEST_MONGODB_URI="mongodb://localhost:27017/?replicaSet=rs0&directConnection=true"`), each run uses a fresh
  uniquely named database on it and drops it afterwards. Otherwise the harness starts an in-memory
  single-node replica set with [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server),
  which downloads a `mongod` binary on first use (hence the long `hookTimeout` in
  [vitest.config.ts](../packages/server/vitest.config.ts) and the binary cache in CI).
- **Replica set.** Required so that time-series collections, change streams and transactions behave as in
  production.
- **If MongoDB is unavailable** (offline, and no binary cached), integration tests are _skipped with the reason
  shown_, not failed, so unit tests still pass on a bare machine.
- The server under test uses `PERSIST_HZ=10`, a known device key and a raised login limit, so tests are fast and
  deterministic.

What the integration tests prove:

| Test                                                                         | Behaviour verified                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health, metrics, bad credentials; session lifecycle; unauthenticated sockets | Login, `me`, refresh, socket token, logout; every namespace rejects unauthenticated sockets                                                                                                         |
| Deltas reach only the subscribed room and duplicates are reported            | Rooms, ingest ack, dedup through the real pipeline                                                                                                                                                  |
| Telemetry is persisted, alerts open and relay to alert subscribers           | The full path from ingest to MongoDB to `/alerts`                                                                                                                                                   |
| Roles                                                                        | Unauthenticated 401, viewer 403 on writes, operator on alerts and commands but not admin resources                                                                                                  |
| History                                                                      | Aligned columns, `lastSeq` equals the highest persisted `seq` and is bounded by the queried range, `maxPoints` honoured, parameter validation, rollups with min/max bands for ranges over two hours |
| Analytics                                                                    | Heatmap matrix with gaps ordered by group, summary with baseline and alert count                                                                                                                    |
| Alerts and rules                                                             | Filter, paginate, ack, resolve; an admin's rule change hot-reloads into the engine                                                                                                                  |
| Commands and chaos                                                           | Command audited and relayed to the connected device; chaos stored, readable by anyone and pushed to devices; pipeline stats                                                                         |
| Admin                                                                        | User management; device keys returned once, only the hash stored, revocation                                                                                                                        |

## Continuous integration

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every push and pull request to `main`, on
`ubuntu-latest` with Node 24 and a 30-minute timeout. A newer run on the same ref cancels the older one. Steps:

1. Check out, set up Node 24 with the npm cache.
2. Restore the cached MongoDB binaries used by `mongodb-memory-server`.
3. `npm ci`
4. `npm run lint`
5. `npm run typecheck`
6. `npm test` (all workspaces, including the integration tests against an in-memory replica set)
7. `npm run build -w @orbitops/web` (production build)

## Manual demo checks

Start the stack ([DEPLOYMENT.md](DEPLOYMENT.md)) and sign in with the demo accounts (password `orbitops`).
Use two different browsers, or one normal and one private window, so the two sessions have separate cookies.

### 1. Live data reaches several clients

1. In browser A sign in as `operator@orbitops.dev`; in browser B as `viewer@orbitops.dev`.
2. Open the same satellite in both (for example the ISS, id 25544). Both should show live values updating and the
   connection badge reading LIVE.
3. Open the System page in either: ingest rate, broadcast rate, client count (at least 2 telemetry clients) and
   latency percentiles update every second.

### 2. Roles are enforced by the server

In the viewer session the command and rule controls should be unavailable. To check the server independently of
the UI:

```bash
# viewer: login, then try to send a command -> 403
curl -s -c viewer.jar -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"viewer@orbitops.dev","password":"orbitops"}'
curl -i -b viewer.jar -X POST http://localhost:4000/api/v1/commands \
  -H 'content-type: application/json' -d '{"satId":25544,"kind":"inject_fault","fault":"thermal"}'
```

Repeat with `operator@orbitops.dev`: the same request returns `202`. An operator calling `GET /api/v1/users` gets
`403`; the admin gets the list.

### 3. Inject a fault and watch the alert propagate

1. As the operator, inject a thermal fault on satellite 25544 from the command panel, or with curl as above using
   the operator's cookie jar.
2. Within a few seconds `panelTempC` climbs toward 150 °C. A CAUTION alert (`tcs.panelOverTemp`, 70 °C) opens,
   then a WARNING (`tcs.panelOverTempCritical`, 85 °C). Both browsers receive the alerts without refreshing, and
   the satellite's status changes on the fleet view.
3. The viewer cannot acknowledge; the operator acknowledges, and the viewer's list updates to `acked`.
4. Send `clear_fault`. The panel cools, and the alerts resolve after three consecutive clear samples.

Other faults to try: `battery` (state of charge collapses; `eps.socDropRate`), `tumble` (`adcs.tumble` and
oscillating solar power) and `comms` (mode `LOS`, link readouts go empty).

### 4. Chaos mode: duplicates, reordering, malformed events

1. As the admin, enable chaos (`PUT /api/v1/system/chaos` with `{"enabled":true,"duplicateRate":0.05,
"reorderRate":0.1,"malformedRate":0.02}`, or the control in the System page).
2. On the System page the `duplicates`, `outOfOrder` and `malformed` counters start rising within seconds, while
   the strip charts stay clean: no duplicated points, no gaps, no spikes from corrupted values.
3. The simulator's console prints how many of each it injected.
4. Disable chaos; the counters stop increasing.

### 5. History and live without a seam

1. Open a satellite's detail page with a history range of about an hour.
2. The trace should continue smoothly into the live edge, with no repeated points at the junction. In the browser
   console, the worker's stats (`duplicates`, `belowWatermark`) show events it dropped at the seam.

### 6. Resilience

- **Server restart.** Stop and start the server. Browsers show RECONNECTING, return to LIVE, and re-subscribe by
  themselves; alerts are reloaded over REST. After the restart `GET /api/v1/telemetry` for a satellite shows no
  duplicated timestamps.
- **Producer restart.** Stop and start the simulator. The server accepts the new stream (its sequence numbers
  start higher) without a burst of duplicates.
- **Login rate limit.** Six wrong passwords within a minute give `429 too_many_attempts`.
- **Metrics.** `curl -s http://localhost:4000/metrics | grep orbitops_` shows ingest, store and broadcast counters.

### 7. Load

Throughput, latency and slow-client behaviour under load are covered by the load-test tools in
[tools/loadtest](../tools/loadtest); methodology and results are in [PERFORMANCE.md](PERFORMANCE.md).
