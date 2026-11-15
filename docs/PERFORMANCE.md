# OrbitOps performance

This document reports what the load tests in `tools/loadtest` actually measured against the OrbitOps server on one development machine. Every number below comes from the JSON files in `tools/loadtest/results/`. Nothing is extrapolated: where a scenario was not pushed to its limit, the text says so.

## What was measured, and how

The harness (`@orbitops/loadtest`) has three parts.

| Part         | File                                       | Role                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingest flood | `src/ingestFlood.ts`                       | Virtual satellites (`sat-<noradId>`) push schema-valid telemetry to `/ingest` with a device API key, using the shared msgpack Socket.IO parser and the real `IngestBatchEnvelope` shape. Measures acknowledged events/s, rejected (rate-limited) events, `retryAfterMs` hints and ack latency (p50/p95/p99).                                                                                               |
| Client swarm | `src/clientSwarm.ts`, `src/swarmWorker.ts` | N viewer clients spread over 4 `worker_threads`. Each is a real `socket.io-client` on `/telemetry` (websocket transport, shared parser) subscribed to a mix of 70% `fleet`, 20% `group:<x>`, 10% `sat:<id>` at 10 Hz. Measures messages/s, payload bytes/s (counted at the parser, so it is the real decoded packet size), end-to-end latency, connected/failed counts and disconnects (including `kick`). |
| Runner       | `src/run.ts`, `src/scenarios.ts`           | Spawns the server as a child process per scenario (port 4020, database `orbitops_loadtest`, `SEED_DEMO=true`, `LOG_LEVEL=warn`), runs a scenario, samples `GET /api/v1/system/stats` once per second plus the server process CPU from `/proc/<pid>/stat`, and writes `results/<scenario>.json` (summaries, not raw samples).                                                                               |

Definitions used in the tables:

- **Ingest acked ev/s**: events the server accepted (`ack.accepted`) divided by the window length. "of N" is the rate the generator offered. In every run `sent == accepted`; the small gap to the offered rate (e.g. 639 of 640) is the window edges, not loss.
- **E2E latency**: time at which a client receives a `TM_DELTA` minus that delta's sample timestamp `t`, for every delta in every message. Generator, server and clients run on the same machine, so the clocks match. At 10 Hz per satellite the generator sends each sample at its own timestamp, so this is essentially the pipeline latency: ingest, the wait for the next 100 ms broadcast tick (about 50 ms on average), fan-out and decode. `fleet` and `group` deltas are coalesced, so they carry the timestamp of the newest sample in the window.
- **Server CPU %**: user plus system CPU of the server process; 100 means one full core. The server is one Node thread, so about 100 is its ceiling.
- **Loop p99**: the server's own `eventLoop.p99Ms` from `/system/stats`. Since commit 9416473 this is event-loop lag above the 10 ms sampling interval (an idle loop reads about 1 ms). All numbers in this document come from runs against that code.
- **Dropped**: the server's `ingest.dropped` counter (telemetry shed by the persistence queue). It was 0 in every scenario.

Each scenario boots a fresh server process. The measured window starts after a 2 s warm-up for the server-side figures; clients are connected before the window starts, so the window sees steady state only.

## Machine

|         |                                                              |
| ------- | ------------------------------------------------------------ |
| CPU     | AMD Ryzen 7 7735HS with Radeon Graphics (16 logical cores)   |
| RAM     | 12.7 GiB                                                     |
| OS      | Linux x64, kernel 7.3.3-1-cachyos                            |
| Node.js | v26.13.1                                                     |
| MongoDB | `mongo:8` single-node replica set in Docker on the same host |

The load generators, the server and MongoDB all share this one machine, and the developer stack (`npm run dev`: server on 4000, simulator, Vite) was also running and mostly idle. Client CPU therefore competes with the server's; see Limitations.

## Results

Window: 30 s per scenario (scenario F: 60 s). Server limits: raised (`DEVICE_EVENTS_PER_SEC=1000000`, `DEVICE_BURST_EVENTS=2000000`) for A to D and F; defaults (3000 ev/s, burst 6000 per 10 s) for E.

### Summary

| Scenario                                 | Ingest acked ev/s | Clients connected | Msgs/s delivered                               | MB/s delivered        | E2E p50 / p95 / p99 (ms) | Ack p99 (ms) | Server CPU % mean / max | RSS MB (max) | Loop lag p99 ms mean / max | Rate-limited ev | Dropped |
| ---------------------------------------- | ----------------- | ----------------- | ---------------------------------------------- | --------------------- | ------------------------ | ------------ | ----------------------- | ------------ | -------------------------- | --------------- | ------- |
| A. 64 sats @ 10 Hz, 100 clients          | 639 of 640        | 100 / 100         | 209                                            | 0.52                  | 73 / 126 / 148           | 1.75         | 13 / 19                 | 196          | 1.1 / 1.7                  | 0               | 0       |
| B. 64 sats @ 10 Hz, 1000 clients         | 639 of 640        | 1,000 / 1,000     | 2,091                                          | 5.10                  | 84 / 145 / 154           | 17.5         | 19 / 34                 | 239          | 3.8 / 10.8                 | 0               | 0       |
| C. max ingest (80,000 ev/s), 100 clients | 79,739 of 80,000  | 100 / 100         | 207                                            | 0.52                  | 58 / 103 / 267           | 36.5         | 83 / 92                 | 442          | 10.9 / 87.8                | 0               | 0       |
| D. 64 sats @ 10 Hz, 5000 clients         | 639 of 640        | 5,000 / 5,000     | 10,240                                         | 25.2                  | 133 / 198 / 221          | 99.3         | 35 / 56                 | 317          | 28.1 / 32.8                | 0               | 0       |
| D (10,000 clients)                       | 639 of 640        | 10,000 / 10,000   | 19,184                                         | 49.2                  | 216 / 320 / 353          | 223.8        | 57 / 81                 | 395          | 65.4 / 267.9               | 0               | 0       |
| E. default limits, 12,800 ev/s flood     | 3,583 of 12,800   | 50 / 50           | 58 (server counter)                            | 0.24 (server counter) | 159 / 204 / 213          | 2.5          | 21 / 28                 | 206          | 0.9 / 1.5                  | 253,320         | 0       |
| F. slow consumer (60 s)                  | 639 of 640        | 101 / 101         | 397 (server counter, incl. the stalled client) | 0.57 (server counter) | 110 / 173 / 188          | n/a          | 12 / 19                 | 221          | 1.2 / 3.1                  | 0               | 0       |

Notes on the columns: "Msgs/s" and "MB/s" for A to D are what the clients received (they match the server's own broadcast counters to within a few percent: A shows 0.52 MB/s on both sides). For E and F the table shows the server's counters (`broadcast.msgsPerSec` and `bytesPerSec`, window means); the client-side figures are in the JSON files. "Ack p99" is the ingest ack round trip measured by the flood, not delivery latency.

Per-kind end-to-end latency (p50 / p99 ms), from the client side:

| Scenario          | fleet (1 Hz) | group (2 Hz) | sat (10 Hz) |
| ----------------- | ------------ | ------------ | ----------- |
| A, 100 clients    | 73 / 149     | 72 / 151     | 104 / 131   |
| B, 1000 clients   | 85 / 155     | 75 / 146     | 73 / 141    |
| D, 5000 clients   | 137 / 222    | 90 / 160     | 80 / 147    |
| D, 10,000 clients | 224 / 355    | 133 / 229    | 107 / 298   |

The `sat` figures in A and B come from few samples (2,975 and 29,780 deltas), so they are noisier than the fleet ones.

### C: ingest ramp

Scenario C keeps 100 viewers connected and raises the offered rate in 8 s steps (64 sources, each step raising `hz`). A step passes when ack p99 is at most 250 ms, nothing is rejected, nothing times out and at least 95% of the offered load is acknowledged. The ramp stops at the first failure, then the best passing level is re-run for the full 30 s window (the C row above).

| Offered ev/s | Acked ev/s | Ack p99 (ms) | Server CPU % (mean) | Loop lag p99 max (ms) | Result                     |
| ------------ | ---------- | ------------ | ------------------- | --------------------- | -------------------------- |
| 1,984        | 1,965      | 2.25         | 17.2                | 1.7                   | pass                       |
| 4,992        | 4,934      | 2.25         | 18.3                | 1.1                   | pass                       |
| 9,984        | 9,856      | 2.0          | 23.8                | 1.1                   | pass                       |
| 20,032       | 19,782     | 2.75         | 35.2                | 1.7                   | pass                       |
| 40,000       | 39,564     | 16.5         | 55.7                | 18.0                  | pass                       |
| 64,000       | 63,125     | 14.25        | 78.8                | 6.8                   | pass                       |
| 80,000       | 79,025     | 140.75       | 92.8                | 97.3                  | pass                       |
| 100,032      | 98,095     | 388.25       | 100.5               | 287.3                 | fail (ack p99 over 250 ms) |

So on this machine the ingest path sustains about 80,000 acknowledged events/s, which is roughly 125 times the nominal 640 ev/s of a 64-satellite fleet at 10 Hz. The limit is the server's single Node thread (CPU pins near 100%). At the 80,000 level the 30 s confirmation run measured ack p99 36.5 ms but a few viewers saw late deltas (fleet p99 288 ms, max 414 ms), and the ramp step itself measured 140 ms, so 80,000 is close to the knee, not comfortably below it. Run-to-run variation exists: earlier runs of this ramp (made with a simpler frame generator and older server revisions, so not comparable and not reported in the table) put the knee between 80,000 and 100,000 ev/s as well.

Frames at this rate are the harness's synthetic ones (smooth orbit plus sensor noise, all numeric fields change), not full physics, and above 1000 Hz per source several samples share a millisecond timestamp (the generator caps each source at 5000 Hz). Persistence is downsampled by the server (`PERSIST_HZ=2` per satellite), so Mongo write load did not grow with ingest rate: the persistence queue stayed at 64 documents or fewer and nothing was dropped.

### E: rate limiting and backpressure

Default device limits are 3000 events/s sustained plus a 6000-event burst allowance per 10 s window, so about 3600 ev/s are admitted over 30 s. The flood offers 12,800 ev/s (64 sources at 200 Hz) from one device key, with 50 viewers connected.

|                                                | Aggressive flood (ignores `retryAfterMs`) | Well-behaved producer (honours `retryAfterMs`) |
| ---------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| Events sent                                    | 382,777                                   | 374,133                                        |
| Events accepted                                | 107,499 (3,583/s)                         | 105,396 (3,513/s)                              |
| Events in rejected batches                     | 275,278                                   | 268,737                                        |
| Rejected batches (`ok:false` + `retryAfterMs`) | 13,741                                    | 2,059                                          |
| Largest `retryAfterMs` hint                    | 776 ms                                    | 973 ms                                         |
| Ack p99                                        | 2.5 ms                                    | 14.5 ms                                        |
| Server CPU mean                                | 21%                                       | 11%                                            |
| Server loop lag p99 (max)                      | 1.5 ms                                    | 5.5 ms                                         |
| Server `rateLimited` counter delta             | 253,320                                   | 256,046                                        |

Accepted throughput lands almost exactly on the configured budget in both cases, rejections are explicit (`ok:false` with a retry hint, not silent loss), rejections are cheap (ack p99 stays in single-digit milliseconds), and the server stayed healthy: no crash, `/healthz` OK afterwards, event-loop lag at most a few milliseconds, zero dropped. A producer that honours `retryAfterMs` sends about 85% fewer rejected batches for the same accepted throughput and costs the server about half the CPU. (The flood does not re-send rejected events: it models a stream that moves on, so "events in rejected batches" is similar in both columns while the batch counts differ greatly.)

Viewer latency in the well-behaved phase is higher (p50 325 ms, p99 838 ms) only because paused sources deliver their samples in bursts, so the sample timestamps are older when they arrive; it is data age, not delivery delay.

### F: slow consumer

100 normal viewers plus one client that subscribes to `fleet`, all seven groups and 40 `sat:` rooms at 10 Hz and then stops reading its TCP socket (the raw socket is paused; its client-side heartbeat watchdog is disabled so the stall cannot end from the client side). The flood is the realistic 64 sats at 10 Hz.

| Observation                                                         | Value                                                                              |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Slow-consumer downgrade (server `slowConsumers` first reads 1)      | 28.5 s after load start                                                            |
| Stalled connection gone from the server (`clients.telemetry` drops) | 38.5 s after load start, i.e. 10 s after the downgrade (the `kickAfterMs` default) |
| Server log lines "slow consumer downgraded"                         | 1                                                                                  |
| What the stalled client saw when resumed after 60 s                 | `transport close` (the server had already closed the socket)                       |
| Normal clients                                                      | 100 / 100 connected, no disconnects; e2e p50 / p95 / p99 110 / 173 / 188 ms        |
| Server                                                              | RSS max 221 MB, loop lag p99 max 3.1 ms, queue depth max 64, dropped 0             |

The normal viewers' latency (p50 110 ms) is slightly above the A baseline (73 ms), but A itself ranged from p50 65 to 90 ms across repeated runs of the same scenario in this session (the generator's random phase moves the average), so this scenario does not show a measurable penalty from the stalled client. The downgrade takes tens of seconds rather than happening immediately because, at this feed rate (the server counters show roughly 50 KB/s extra for the one stalled client), the operating system's socket buffers evidently take about that long to fill before the server's write buffer crosses the thresholds in `ws/backpressure.ts` (200 queued packets or 1 MiB). That explanation is inferred from the timing, not measured directly. The stalled client's `kick` counter stayed 0: the `kick` event is queued behind the stalled data and the socket is closed immediately afterwards, so a client that truly cannot read sees only the connection close, not the `kick` reason. A client that stalls completely is also bounded by Socket.IO's heartbeat (25 s ping interval plus 20 s timeout), which would close it at about 45 s regardless.

## Why these numbers are achievable

The design choices that keep per-client cost low, in the order data flows:

- **Ingest batching and a per-source pipeline.** Producers send one batch per source every 100 ms with an ack; validation is per event, then per-device token-bucket rate limiting, dedup, a small reorder buffer, state update and anomaly evaluation. The ack carries `retryAfterMs` so producers back off instead of the server queueing unboundedly.
- **Persistence off the hot path.** Samples are downsampled to `PERSIST_HZ` per satellite and written by a bounded queue (oldest samples shed first), so ingest rate does not translate into database write rate.
- **Delta encoding.** The state store keeps the last frame per satellite and broadcasts only changed fields, after rounding to a per-field precision, with one- or two-character keys. In this run the 100-client baseline delivered about 4,950 deltas/s in 209 messages/s at 0.52 MB/s in total.
- **MessagePack framing.** Every Socket.IO packet is a single msgpack value (shared `socketParser`), smaller and cheaper to encode than JSON.
- **Rooms and encode-once fan-out.** `sat:<id>`, `group:<g>` and `fleet` rooms mean each payload is built once and written to every member by Socket.IO's room broadcast. This is why 10,000 viewers cost about 57% of one core on average here.
- **Rate tiers.** `fleet` is coalesced to 1 Hz with a reduced field set, `group` to 2 Hz, `sat` rooms run at up to 10 Hz, and clients can ask for 1, 2, 5 or 10 Hz per socket (a per-socket merged batch for those below 10 Hz).
- **Reliable emits with explicit backpressure.** Telemetry is not sent as `volatile` (Socket.IO drops a volatile packet whenever the socket is still flushing the previous one, which would starve multi-room clients). Instead every client gets reliable emits and `ws/backpressure.ts` watches each socket's write buffer: a client above 200 queued packets or 1 MiB is downgraded to the 1 Hz fleet feed, and kicked if it stays slow for 10 s. Scenario F exercises this end to end.

These are design properties, not separate measurements: the load test does not toggle each optimisation off, so it does not attribute a share of the results to each one.

## Reproduce

Prerequisites: MongoDB running (`docker compose up -d mongo`), `npm install` done, Node 24 or newer.

```bash
# one scenario (spawns its own server on port 4020 and database orbitops_loadtest)
npm run loadtest -w @orbitops/loadtest -- --scenario B

# all scenarios, then the 10,000 client variant of D
npm run loadtest -w @orbitops/loadtest -- --scenario all --duration 30
npm run loadtest -w @orbitops/loadtest -- --scenario D --clients 10000 --suffix -10k

# against a server you already started (its rate limits cannot be changed by the runner)
npm run loadtest -w @orbitops/loadtest -- --scenario A --no-spawn --url http://localhost:4000 --pid <server pid>

# the generators on their own
npm run ingest -w @orbitops/loadtest -- --url http://localhost:4000 --sources 64 --hz 10 --duration 30
npm run swarm -w @orbitops/loadtest -- --url http://localhost:4000 --clients 1000 --duration 30
```

Flags: `--scenario A|B|C|D|E|F|all`, `--duration <s>`, `--clients <n>` (A, B, D), `--port`, `--suffix`. Scenario F runs for at least 60 s whatever `--duration` says. Results are written to `tools/loadtest/results/<scenario>.json` together with `machine.json`.

## Design notes on the harness

- **Sources.** The server only accepts sources in its satellite catalogue (65 seeded from `data/satellites.json`), so the flood cannot scale by adding sources. Load beyond 64 sources is produced by raising the rate per source (`--hz`, up to 5000). Each source keeps one batch in flight, like the real simulator transport.
- **seq numbers.** They are seeded from the wall clock (10 per millisecond) so a later run never reuses sequence numbers the server already persisted for the same satellite.
- **Auth.** The server limits logins to 5 per minute per IP and the REST API to 300 requests per minute per IP, so a swarm cannot log in once per client. The harness logs in once and every virtual viewer passes that 15-minute access token as its Socket.IO `auth.token`; the server still verifies the JWT on every handshake.
- **Client counting.** The swarm counts bytes in a thin subclass of the shared `Decoder`, so the figures are real packet sizes. `forceNew` sockets are used so every client has its own connection.
- **Why not Artillery.** Artillery's Socket.IO engine speaks the default Socket.IO parser. OrbitOps uses a custom msgpack parser on both sides (`@orbitops/shared` `socketParser`), which Artillery's engine cannot load, and a client without it cannot even complete the handshake. Artillery is therefore not installed; the harness uses `socket.io-client` with the shared parser directly, which also keeps the load generator on the exact wire format production uses.
- **Load-generator health.** Each worker reports its own event-loop p99; it stayed at 21 to 22 ms in every scenario including 10,000 clients (that is the idle floor of its 20 ms sampling timer), so the client side was not itself saturated by the event loop. It did, however, consume CPU on the shared machine.

## Limitations

- **One machine.** Server, load generators, MongoDB and an idle developer stack share 16 logical cores. A 10,000 client run means the client workers burn CPU the server would otherwise have. The loopback network has no latency, packet loss or bandwidth cap, so real WAN clients would see more latency and would hit the slow-consumer thresholds sooner or later depending on their links.
- **Single runs.** Each scenario reports one 30 s window (one run in the final table), not an average over repeats. Run-to-run spread is visible: baseline E2E p50 ranged from 65 to 90 ms across repeated A runs in this session; the C ramp knee moved between runs. Treat differences of a few tens of milliseconds as noise.
- **Synthetic data.** Frames are plausible but are not the full orbit and spacecraft model; alert activity was not exercised (values stay nominal), so alert fan-out cost is not included.
- **Latency is data age.** It includes the 100 ms broadcast tick and, for fleet and group rooms, coalescing. It is not a network round trip.
- **Shared access token.** All viewers authenticate with one user's token, so per-user auth cost is not varied; login throughput is not measured.
- **Single server process.** There is no horizontal scaling test (no Redis adapter, no multiple instances); the figures are one Node process.
- **Clients are not browsers.** Rendering cost, and the cost of the real web app's decode and chart updates, are out of scope.
- **Scenario D limit.** 10,000 viewers all connected without failures; the machine was not pushed beyond that, so it is not a maximum. At 10,000 the fleet feed's p99 was 355 ms and the server's loop lag p99 peaked at 268 ms: still working, with visibly less headroom.
