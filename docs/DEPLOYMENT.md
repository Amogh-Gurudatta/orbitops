# Deployment

OrbitOps runs in three ways: locally for development (MongoDB in Docker, everything else with `npm run dev`),
as a full Docker stack, and on Render with MongoDB Atlas's free tier. In production one Node process serves the
API, Socket.IO and the built web app from a single origin, and can also run the simulator as a child process.
This document gives the steps for each, the free-tier caveats, and every environment variable.

Requirements: Node 24 or newer (`engines` in [package.json](../package.json)), npm, and Docker for MongoDB.

## 1. Local development

```bash
npm install
npm run db:up                    # docker compose up -d mongo  (MongoDB 8, single-node replica set)

cp packages/server/.env.example packages/server/.env
cp packages/simulator/.env.example packages/simulator/.env
# In packages/simulator/.env, DEVICE_API_KEY must match packages/server/.env (the examples differ:
# set both to the same value, for example dev-simulator-key-change-me).

npm run dev                      # server (4000) + simulator + web (5173) via concurrently
```

Open <http://localhost:5173>. Vite proxies `/api` and `/socket.io` (WebSocket included) to the server on port
4000, so the browser still sees one origin and cookies are first-party.

On first start the server (with `SEED_DEMO` on, the default outside production) creates the collections,
loads the 64 satellites and 16 ground stations from [data](../data), registers the device key from
`DEVICE_API_KEY`, inserts the default alert rules, and creates three demo accounts:

| Account                 | Password   | Role     |
| ----------------------- | ---------- | -------- |
| `viewer@orbitops.dev`   | `orbitops` | viewer   |
| `operator@orbitops.dev` | `orbitops` | operator |
| `admin@orbitops.dev`    | `orbitops` | admin    |

Useful commands:

| Command                              | What it does                                                     |
| ------------------------------------ | ---------------------------------------------------------------- |
| `npm run seed`                       | Re-run the idempotent seed (users, device, satellites, stations) |
| `npm run dev -w @orbitops/server`    | Server only (`tsx watch`)                                        |
| `npm run dev -w @orbitops/simulator` | Simulator only                                                   |
| `npm run build -w @orbitops/web`     | Production build of the web app into `packages/web/dist`         |
| `docker compose down`                | Stop MongoDB (add `-v` to delete its data volume)                |

MongoDB runs as a replica set because the alert manager uses a change stream to relay alerts between server
instances. The server still starts against a standalone MongoDB; it logs a warning and the cross-instance relay
is off.

To run the server in single-origin mode locally: build the web app, then start the server with
`SERVE_WEB=true` and open port 4000.

## 2. Full Docker stack

[compose.app.yml](../compose.app.yml) adds the server (which serves the built web app) and a separate simulator
container to the MongoDB service in [docker-compose.yml](../docker-compose.yml). Both use the root
[Dockerfile](../Dockerfile): a build stage runs `npm ci` and the web build; the runtime stage keeps the
workspace sources and runs TypeScript through `tsx`, as the unprivileged `node` user, with a `/healthz`
health check.

```bash
JWT_SECRET=<at least 32 random characters> \
DEVICE_API_KEY=<at least 8 characters> \
  docker compose -f docker-compose.yml -f compose.app.yml up --build
```

Open <http://localhost:4000> once the server is healthy. The simulator starts after the server reports healthy.

[compose.app.yml](../compose.app.yml) sets `SEED_DEMO=true`, so the first start creates the demo accounts,
satellite catalogue, ground stations and the device key even though the stack runs with `NODE_ENV=production`.

The compose file connects with `directConnection=true` because MongoDB's replica set advertises `localhost`
as its host name, which other containers cannot reach.

## 3. Render and MongoDB Atlas (free tier)

The [render.yaml](../render.yaml) blueprint defines one free web service built from the Dockerfile. It serves
the API, Socket.IO and the web app on one origin, and runs the simulator as a child process
(`EMBED_SIMULATOR=true`) because Render has no free background workers.

### Step 1: create the database (MongoDB Atlas M0)

1. Sign in to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and create a project, then **Create a
   cluster** and choose the free **M0** tier. Pick a region close to your Render region.
2. **Database Access**: add a database user with a password and the _Read and write to any database_ role.
   Avoid special characters in the password, or URL-encode them in the connection string.
3. **Network Access**: add an IP access list entry. Render's free tier has no fixed outbound addresses, so
   allow access from anywhere (`0.0.0.0/0`). The database user's password is then the control that matters.
4. **Connect, Drivers**: copy the connection string, which looks like
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`. Insert the database
   name before the `?`: `...mongodb.net/orbitops?retryWrites=true&w=majority`. This is your `MONGODB_URI`.

Atlas clusters are replica sets, so the alert change stream works.

### Step 2: deploy on Render

1. Push the repository to GitHub.
2. In Render, **New, Blueprint**, select the repository. Render reads `render.yaml` and proposes the
   `orbitops-web` service.
3. Fill in the two variables the blueprint leaves empty (`sync: false`):
   - `MONGODB_URI`: the Atlas string from step 1.
   - `CLIENT_ORIGIN`: the service's public URL, for example `https://orbitops-web.onrender.com`. It feeds the
     CORS allow-list and the Content-Security-Policy WebSocket origin. If you do not know the URL yet, deploy
     once, copy it from the Render dashboard, set the variable, and redeploy.
4. Render generates `JWT_SECRET` and `DEVICE_API_KEY` itself (`generateValue: true`). The server seeds a device
   from `DEVICE_API_KEY`, and the embedded simulator authenticates with the same value.
5. Deploy. The health check path is `/healthz`. Sign in with a demo account from the table above; the blueprint
   sets `SEED_DEMO=true`.

What the blueprint sets: `NODE_ENV=production`, `SERVE_WEB=true`, `PERSIST_HZ=1`, `RAW_TTL_HOURS=6`,
`SEED_DEMO=true`, `TRUST_PROXY=1`, `ROLLUP_TTL_DAYS=7`, `EMBED_SIMULATOR=true`, `EMBED_SIMULATOR_HZ=2`, plus the
three variables above.

To run the simulator somewhere else instead, set `EMBED_SIMULATOR=false` and start it with `SERVER_URL` pointing
at the Render URL and the same `DEVICE_API_KEY`:

```bash
SERVER_URL=https://orbitops-web.onrender.com DEVICE_API_KEY=<value from Render> \
  npm run start -w @orbitops/simulator
```

### Reverse proxies and `TRUST_PROXY`

Render terminates TLS and forwards requests through a proxy. Without `TRUST_PROXY=1` the server sees the
proxy's address for every request, so all users share one REST rate-limit bucket and one login-attempt bucket
(5 per minute), and the rate limiter logs a warning about the forwarded header. Set `TRUST_PROXY` to the number
of proxy hops in front of the server (1 on Render). The blueprint does not set it today, so add it by hand.

### Free-tier caveats

| Topic                    | What to expect                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sleeping**             | Render free web services spin down after 15 minutes without inbound traffic and take tens of seconds to start again. While the service sleeps the embedded simulator is stopped too, so no new telemetry is produced. Open the URL a minute before a demo. On wake the simulator restarts; its sequence numbers start above everything it sent before, and the server skips samples it has already stored. |
| **Memory**               | The free instance is small (512 MB at the time of writing) and holds the server and the simulator process. The default 2 Hz embedded rate is chosen with that in mind.                                                                                                                                                                                                                                     |
| **Atlas M0 storage**     | The free cluster is limited to 512 MB (check Atlas for current figures). Raw telemetry is bounded by `RAW_TTL_HOURS`; rollups are kept `ROLLUP_TTL_DAYS` (30 by default, 7 in the blueprint; see below).                                                                                                                                                                                                   |
| **Atlas M0 throughput**  | Shared cluster with an operations-per-second throttle (about 100 per second as assumed when this project was planned; verify in the Atlas docs).                                                                                                                                                                                                                                                           |
| **Database unreachable** | If MongoDB cannot be reached the server gives up after 10 s at start-up and exits, and the deploy fails its health check. Check the connection string, the database user and the Atlas network access list.                                                                                                                                                                                                |

**Why `PERSIST_HZ=1` and `RAW_TTL_HOURS=6`.** The live feed is not downsampled, but what is _stored_ is.
At `PERSIST_HZ=1`, 64 satellites write 64 documents per second, which is 1,382,400 documents over the 6-hour
raw window (twice that at the default of 2). Writes are batched (up to 1000 documents per `insertMany`, flushed
every 500 ms), so the database sees a few commands per second rather than 64, which keeps the demo well inside a
throttled shared cluster. Six hours is enough for the History and Replay views and for the rollup job to build
its summaries, while the TTL keeps the raw collection from filling the disk.

**Rollup storage on M0.** Minute rollups are created for every satellite every minute (92,160 documents per day
for 64 satellites) and expire after `ROLLUP_TTL_DAYS` (default 30; the Render blueprint sets 7). At a rough 700 bytes per document plus indexes that is on the order of 70-80
MB per day of continuous running, so a service left running for about a week can approach the 512 MB limit. For
a long-lived deployment on M0, either watch storage in Atlas, drop the `telemetry_1m` collection occasionally,
or lower `ROLLUP_TTL_DAYS`. A free Render service that sleeps stores far less. The figure is an estimate, not a
measurement.

## Environment variables

### Server

Parsed once at boot by [config.ts](../packages/server/src/config.ts) with zod; an invalid value stops the
server with a readable message. Locally, `node --env-file-if-exists=.env` loads `packages/server/.env`.

| Variable                | Default                                                                   | Meaning                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`              | `development`                                                             | `development`, `test` or `production`. Production requires `JWT_SECRET`, marks cookies `Secure`, and turns demo seeding off by default |
| `PORT`                  | `4000`                                                                    | HTTP and Socket.IO port                                                                                                                |
| `MONGODB_URI`           | `mongodb://localhost:27017/orbitops?replicaSet=rs0&directConnection=true` | MongoDB connection string                                                                                                              |
| `CLIENT_ORIGIN`         | `http://localhost:5173`                                                   | Comma-separated browser origins for CORS, Socket.IO CORS and the CSP WebSocket origin                                                  |
| `JWT_SECRET`            | (dev fallback)                                                            | Token signing secret; at least 32 characters, mandatory in production                                                                  |
| `DEVICE_API_KEY`        | (dev fallback outside production)                                         | Bootstrap device key (8+ characters). Seeded as a device (stored hashed) when seeding is on; also used by the embedded simulator       |
| `PERSIST_HZ`            | `2`                                                                       | Samples stored per satellite per second, above 0 and at most 10                                                                        |
| `RAW_TTL_HOURS`         | `6`                                                                       | Retention of raw telemetry                                                                                                             |
| `ROLLUP_TTL_DAYS`       | `30`                                                                      | Retention of minute rollups (`telemetry_1m`)                                                                                           |
| `SERVE_WEB`             | `false`                                                                   | Serve `packages/web/dist` and fall back to `index.html` for client routes. The Docker image sets it to `true`                          |
| `SEED_DEMO`             | `true` outside production, `false` in production                          | Seed demo users, satellites, ground stations and the device key into empty collections at boot                                         |
| `TRUST_PROXY`           | `0`                                                                       | Number of reverse-proxy hops to trust for client IP (set to `1` on Render)                                                             |
| `LOG_LEVEL`             | `info`                                                                    | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                                         |
| `DEVICE_EVENTS_PER_SEC` | `3000`                                                                    | Sustained per-device ingest limit                                                                                                      |
| `DEVICE_BURST_EVENTS`   | `6000`                                                                    | Extra events allowed per 10 s per device                                                                                               |
| `EMBED_SIMULATOR`       | `false`                                                                   | Run the simulator as a supervised child process (needs `DEVICE_API_KEY`)                                                               |
| `EMBED_SIMULATOR_HZ`    | `2`                                                                       | Embedded simulator rate, 1 to 10                                                                                                       |

Boolean variables accept `true`/`false` (and the usual equivalents such as `1`/`0`).

### Simulator

Parsed by [config.ts](../packages/simulator/src/config.ts). Details in [SIMULATION.md](SIMULATION.md#configuration).

| Variable         | Default                 | Meaning                                           |
| ---------------- | ----------------------- | ------------------------------------------------- |
| `SERVER_URL`     | `http://localhost:4000` | Server to push telemetry to                       |
| `DEVICE_API_KEY` | (empty)                 | Plaintext device key                              |
| `SIM_HZ`         | `5`                     | Samples per second per satellite, 1 to 10         |
| `SIM_SHARD`      | `0/1`                   | `index/count` split of the fleet across processes |
| `SIM_SATS`       | (all)                   | Comma-separated NORAD ids to simulate             |
| `SIM_TIME_SCALE` | `1`                     | Simulated seconds per wall-clock second           |
| `TLE_REFRESH`    | `false`                 | Try a live CelesTrak element refresh at boot      |

### Tests only

| Variable           | Meaning                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TEST_MONGODB_URI` | Use this MongoDB for the server integration tests instead of an in-memory replica set ([TESTING.md](TESTING.md#integration-test-infrastructure)) |

## Operations

- **Health:** `GET /healthz` returns 200 when MongoDB is connected, 503 otherwise. Docker and Render use it.
- **Metrics:** `GET /metrics` exposes Prometheus metrics (`orbitops_*`). The same numbers are on the System
  page and over the `system` room. See [API.md](API.md#system-admin-and-operations).
- **Logs:** pino JSON in production; request logging skips `/healthz` and `/metrics`; cookies and authorization
  headers are redacted.
- **Shutdown:** on `SIGINT` or `SIGTERM` the server stops the simulator, closes sockets, writes out everything in
  the persistence queue, and disconnects from MongoDB, with a 15-second forced-exit timeout.
- **Scaling:** run one server instance. Ingest state is in process; see
  [limits of the current design](ARCHITECTURE.md#limits-of-the-current-design).
