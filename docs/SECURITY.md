# Security

OrbitOps authenticates people with short-lived JWTs in httpOnly cookies, authenticates telemetry producers with
hashed device keys, authorises actions by role, validates every input with strict schemas, and rate limits at
each entry point. This document describes each control as implemented and lists the known limitations, including
deliberate demo shortcuts.

Code: [auth](../packages/server/src/auth), [app.ts](../packages/server/src/app.ts),
[config.ts](../packages/server/src/config.ts), [ingest](../packages/server/src/ingest),
[ws](../packages/server/src/ws).

## Authentication

### People (JWT in cookies)

| Token   | Lifetime   | Cookie                                      | Purpose                                         |
| ------- | ---------- | ------------------------------------------- | ----------------------------------------------- |
| Access  | 15 minutes | `oo_at`, path `/`                           | Authorises REST calls and Socket.IO handshakes  |
| Refresh | 7 days     | `oo_rt`, path `/api/v1/auth`                | Used only by the auth routes to renew a session |
| Socket  | 60 seconds | none (returned by `GET /auth/socket-token`) | For socket clients that cannot send cookies     |

- Tokens are HS256 JWTs signed with `JWT_SECRET` ([jose](https://github.com/panva/jose)), issuer `orbitops`.
  Each carries a `use` claim (`access`, `refresh` or `socket`) and is only accepted for that use, so a refresh
  token cannot be replayed as an access token.
- Cookies are `httpOnly` (not readable by scripts), `SameSite=Lax`, and `Secure` when `NODE_ENV=production`. The
  refresh cookie is scoped to the auth path, so it is not sent with ordinary requests.
- `POST /auth/refresh` reloads the user from the database, so a changed role or deleted account takes effect at
  the next refresh (at most 15 minutes later for access tokens already issued).
- Passwords are hashed with **argon2id** ([@node-rs/argon2](https://github.com/napi-rs/node-rs/tree/main/packages/argon2)
  defaults). Login verifies against a decoy hash when the e-mail is unknown, so response time does not reveal
  whether an account exists; the error is the same `invalid_credentials` either way.
- In production the server refuses to start unless `JWT_SECRET` is at least 32 characters. Outside production a
  missing or short secret falls back to a well-known development value and logs a warning.

### Sockets

- `/telemetry` and `/alerts` accept the access cookie (browsers) or `auth: { token }` (socket token or access
  token). Failure is the connect error `unauthorized`.
- `/ingest` accepts only `auth: { apiKey }`.

### Devices (telemetry producers)

- Device keys are generated as `oo_dev_` plus 24 random bytes (base64url) and shown **once** at creation.
- Only the sha256 of a key is stored. Lookup is by hash and the stored hash is compared in constant time
  (`timingSafeEqual`). Keys shorter than 8 or longer than 256 characters are rejected before hashing.
- Each device has an `allowedSources` list (default `["*"]`). A device that publishes for a source outside it
  gets its batch rejected. An unknown `sourceId` (not in the satellite catalogue) is rejected too.

## Authorisation

Every `/api/v1` route except the three session routes requires a valid access token
([middleware.ts](../packages/server/src/auth/middleware.ts)); role checks are applied per route.

### Role matrix

| Action                                                            | viewer | operator | admin |
| ----------------------------------------------------------------- | :----: | :------: | :---: |
| Sign in, refresh, sign out                                        |  yes   |   yes    |  yes  |
| View fleet, satellites, passes, ground stations                   |  yes   |   yes    |  yes  |
| View telemetry history, analytics, replay                         |  yes   |   yes    |  yes  |
| View alerts, alert rules, commands, pipeline stats, chaos setting |  yes   |   yes    |  yes  |
| Subscribe to live telemetry, alert and system rooms               |  yes   |   yes    |  yes  |
| Acknowledge or resolve an alert                                   |   no   |   yes    |  yes  |
| Send a satellite command (inject or clear a fault, safe mode)     |   no   |   yes    |  yes  |
| Edit an alert rule                                                |   no   |    no    |  yes  |
| Switch chaos mode on or off, change its rates                     |   no   |    no    |  yes  |
| List, create users; change a user's role                          |   no   |    no    |  yes  |
| List, create, delete device keys                                  |   no   |    no    |  yes  |

Roles are matched exactly: a route lists every role that may pass. An admin cannot change their own role, so the
last administrator cannot be demoted by accident. Role checks are enforced on the server, independently of
anything the UI shows or hides. The [integration tests](../packages/server/src/api.integration.test.ts) check
that viewers get 403 when they try to acknowledge or resolve alerts, send commands, tune rules or toggle chaos,
and that operators cannot reach the admin resources.

## Input validation

- **zod 4 everywhere.** Request bodies, path parameters, query strings, environment variables and socket
  payloads are parsed with schemas. Object schemas are `strictObject`, so unknown fields are rejected, not
  ignored. Failures return `400 validation_failed` with field-level details
  ([errors.ts](../packages/server/src/http/errors.ts)).
- **Telemetry events.** Each event is checked against the full frame schema: every numeric field is finite
  (`NaN` and `Infinity` are rejected) and range checked, `stationId` and `mode` are constrained, and `seq` and
  `ts` are non-negative integers. Events stamped more than 5 s ahead of the server or more than 1 h old are
  rejected. A batch holds at most 500 events and a socket message at most 256 KiB
  ([telemetry.ts](../packages/shared/src/telemetry.ts), [validate.ts](../packages/server/src/ingest/validate.ts)).
- **Query injection.** Mongoose runs with `sanitizeFilter`, which neutralises operator objects such as
  `{ "$gt": ... }` in user-supplied filters. The few places that deliberately use operators wrap them in
  Mongoose's `trusted()`. Metric names that become field names in projections or aggregations are checked
  against fixed allow-lists (enums), never interpolated from free text.
- **Subscriptions.** Room names are parsed against a strict grammar; unknown rooms are rejected.
- **Bodies.** JSON bodies are limited to 256 KiB. A malformed body is `400 bad_request`, an oversized one `413`.
- **Error hygiene.** Unexpected errors are logged with the request and returned as a generic `500
internal_error`, with no stack trace or internal detail.

## Rate limiting and resource limits

| Entry point                 | Limit                                                                                                                      | Behaviour when exceeded                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| REST `/api/v1`              | 300 requests per minute per IP                                                                                             | `429 rate_limited`, `RateLimit` headers                                      |
| `POST /auth/login`          | 5 attempts per minute per IP                                                                                               | `429 too_many_attempts`                                                      |
| Device ingest               | Token bucket per device: 3000 events/s sustained plus 6000 extra per 10 s (`DEVICE_EVENTS_PER_SEC`, `DEVICE_BURST_EVENTS`) | Ack `{ ok: false, retryAfterMs }`, batch discarded, counted as `rateLimited` |
| Socket subscription changes | 20 `sub`/`unsub` per 10 s per connection                                                                                   | Ack error `rate_limited`                                                     |
| Rooms per connection        | 50                                                                                                                         | Ack error `too_many_rooms`                                                   |
| Message size                | 256 KiB per Socket.IO message, 256 KiB per JSON body                                                                       | Connection error / `413`                                                     |
| Slow readers                | Over 200 queued packets or 1 MiB buffered                                                                                  | Downgrade, then disconnect after 10 s                                        |

REST limits are in memory and keyed by client IP. Behind a reverse proxy, set `TRUST_PROXY` to the number of
proxy hops, otherwise every user shares the proxy's address and therefore one bucket. See
[DEPLOYMENT.md](DEPLOYMENT.md#reverse-proxies-and-trust_proxy).

## Browser and network hardening

- **helmet** sets the standard security headers and a Content-Security-Policy
  ([app.ts](../packages/server/src/app.ts)):

  | Directive                   | Value                                                                                             |
  | --------------------------- | ------------------------------------------------------------------------------------------------- |
  | `default-src`               | `'self'`                                                                                          |
  | `script-src`                | `'self'`, `'wasm-unsafe-eval'`                                                                    |
  | `style-src`                 | `'self'`, `'unsafe-inline'` (React style props and deck.gl set styles at runtime)                 |
  | `img-src`                   | `'self'`, `data:`, `blob:`, map-tile hosts (`*.basemaps.cartocdn.com`, `gibs.earthdata.nasa.gov`) |
  | `connect-src`               | `'self'`, the `ws(s)://` form of each `CLIENT_ORIGIN`, the map-tile hosts                         |
  | `worker-src`                | `'self'`, `blob:`                                                                                 |
  | `object-src`                | `'none'`                                                                                          |
  | `frame-ancestors`           | `'none'` (no framing, which prevents clickjacking)                                                |
  | `upgrade-insecure-requests` | on in production                                                                                  |

- **CORS** allows only the origins listed in `CLIENT_ORIGIN` (comma-separated), with credentials. The same list
  applies to Socket.IO. In the single-origin deployment the browser makes same-origin requests and CORS is not
  exercised.
- **CSRF.** There is no CSRF token. Protection rests on `SameSite=Lax` cookies (not sent on cross-site POSTs),
  JSON-only body parsing (cross-site HTML forms cannot send `application/json`), and the CORS allow-list.
- `X-Powered-By` is disabled; the server runs as the unprivileged `node` user in the container.

## Known limitations

These are deliberate trade-offs for a demonstration or gaps to close before production use.

| Area                      | Limitation                                                                                                                                                                                                                                                                      | Mitigation                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Demo accounts             | With `SEED_DEMO=true` (the default outside production, and set in the Render blueprint) three accounts exist: `viewer@orbitops.dev`, `operator@orbitops.dev`, `admin@orbitops.dev`, all with password `orbitops`. Anyone who can reach a deployed demo can sign in as an admin. | Intended so judges can sign in. Set `SEED_DEMO=false` and create real users for anything else. Seeding only fills empty collections and never overwrites existing users. |
| Development defaults      | Outside production a missing `JWT_SECRET` or `DEVICE_API_KEY` falls back to a public development value.                                                                                                                                                                         | Production refuses a missing or short `JWT_SECRET`; in production no default device key is seeded.                                                                       |
| `/metrics` and `/healthz` | Unauthenticated, so anyone can read operational metrics. No personal data is exposed.                                                                                                                                                                                           | Restrict the path at the proxy or network layer if the deployment is public.                                                                                             |
| Token revocation          | JWTs are stateless: logout clears cookies but does not invalidate a token already copied elsewhere. An access token lives up to 15 minutes, a refresh token up to 7 days.                                                                                                       | Deleting a user stops refreshes. Short access lifetime limits exposure.                                                                                                  |
| Long-lived sockets        | Credentials are checked at handshake only. A connected socket stays connected after its token expires, and deleting a device key does not disconnect a device that is already connected.                                                                                        | The web client renews its session when a handshake is refused; restart or disconnect devices after revoking keys.                                                        |
| Room access               | Any authenticated role may join any room in its namespace, including `system` (pipeline stats). Roles gate actions, not read access.                                                                                                                                            | Acceptable for a shared operations view; add per-role room rules if data must be partitioned.                                                                            |
| One secret                | All three token uses share `JWT_SECRET`, separated by the `use` claim rather than by key.                                                                                                                                                                                       | Rotating the secret signs everyone out.                                                                                                                                  |
| Rate-limit scope          | Limits are in process memory, per IP for REST. They reset on restart and are not shared between instances. Behind a proxy without `TRUST_PROXY` they collapse into one bucket.                                                                                                  | Set `TRUST_PROXY`; use a shared store if running multiple instances.                                                                                                     |
| Login protection          | Brute-force protection is the per-IP limit only; there is no account lockout or failed-login audit trail.                                                                                                                                                                       | Commands are audited (who, what, when).                                                                                                                                  |
| CSP                       | `style-src 'unsafe-inline'` is required by runtime-set styles; `wasm-unsafe-eval` is allowed for WebAssembly.                                                                                                                                                                   | Scripts are restricted to same-origin.                                                                                                                                   |
| Transport                 | The app does not terminate TLS itself; HTTPS is provided by the host (Render does this). Cookies are marked `Secure` only in production mode.                                                                                                                                   | Run behind HTTPS in any shared environment.                                                                                                                              |
