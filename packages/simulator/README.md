# @orbitops/simulator

The data source for OrbitOps. Each satellite in `data/satellites.json` gets an agent that propagates a real
SGP4 orbit (satellite.js), computes Earth shadow, and runs a small spacecraft model (solar power, battery,
thermal, ground-station link, attitude, propellant). Samples are batched every 100 ms per satellite and sent to
the server's `/ingest` Socket.IO namespace (msgpack parser from `@orbitops/shared`, device API key in `auth.apiKey`).

## Run

```sh
cp .env.example .env            # set DEVICE_API_KEY (plaintext key from the server seed / POST /api/v1/devices)
npm run dev -w @orbitops/simulator
```

## Environment

| Variable         | Default                 | Meaning                                                                                 |
| ---------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `SERVER_URL`     | `http://localhost:4000` | Server origin; connects to `${SERVER_URL}/ingest`.                                      |
| `DEVICE_API_KEY` | empty                   | Device key sent as `auth.apiKey`.                                                       |
| `SIM_HZ`         | `5`                     | Samples per second per satellite, clamped to 1..10.                                     |
| `SIM_SHARD`      | `0/1`                   | `index/count`: simulate only satellites at positions where `position % count == index`. |
| `SIM_SATS`       | all                     | Comma-separated NORAD ids. Applied before sharding.                                     |
| `SIM_TIME_SCALE` | `1`                     | Simulated seconds per real second. Event timestamps stay on the wall clock.             |
| `TLE_REFRESH`    | `false`                 | `true` = once at boot, fetch live TLEs from CelesTrak (see below).                      |

### Multiple sources (shards)

Each process is one independent source with its own connection. Run several to split the fleet:

```sh
SIM_SHARD=0/3 npm start -w @orbitops/simulator &
SIM_SHARD=1/3 npm start -w @orbitops/simulator &
SIM_SHARD=2/3 npm start -w @orbitops/simulator &
```

### Orbital elements

The bundled snapshot is always the baseline. With `TLE_REFRESH=true` the simulator makes one sequential pass
over its satellites at boot (`https://celestrak.org/NORAD/elements/gp.php?CATNR=<id>&FORMAT=TLE`, 5 s timeout,
300 ms between requests) and aborts the whole refresh on the first failure, silently falling back to the
snapshot. It is off by default to be polite to CelesTrak. TLE data: CelesTrak (https://celestrak.org).

## Behaviour

- **Seq numbers** start at `floor(Date.now() / 100)` per satellite and increase by one per sample. The server
  keeps a per-source seq high-watermark across restarts; the seed grows at 10/s while seq advances at most
  `SIM_HZ` (<= 10) per second, so a restarted process always starts above what it sent before.
- **Shadow** uses satellite.js `shadowFraction` with `sunPos` (conical umbra and penumbra).
- **Mode**: `LOS` when a comms fault is active, else `SAFE`, else `DEGRADED` (battery, thermal or tumble fault),
  else `ECLIPSE` when shadow > 0.5, else `NOMINAL`.
- **Backpressure**: an ack `{ok:false, retryAfterMs}` pauses that source for `retryAfterMs`. Per-source buffer is
  bounded at 200 samples (oldest dropped, counted). Ack timeout is 2 s; unacked events stay buffered and are
  retried with the next batch. While disconnected, samples buffer and are resent on reconnect.
- **Status line** every 10 s: satellites, events/s sent, acks ok/rejected/timeouts, buffered, dropped (and chaos
  counters when chaos is on).

## Faults (server `cmd` events)

Commands for satellites outside this shard are ignored.

| Command                          | Effect (simulated time)                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `inject_fault` `battery`         | SoC drains 5 % of full charge per second: below 0.2 within ~14 s (`DEGRADED`).          |
| `inject_fault` `thermal`         | Panel temperature heads to 150 C with a 15 s time constant: past 85 C in ~15 s.         |
| `inject_fault` `tumble`          | Attitude rate 3-8 dps; solar power oscillates on a 5 s period.                          |
| `inject_fault` `comms`           | No link even with a station in view; station/RSSI/SNR/elevation null, mode `LOS`.       |
| `clear_fault` (+ optional fault) | Removes that fault, or all faults when none is given. Overheated panels cool in ~1 min. |
| `safe_mode` / `nominal_mode`     | Sheds loads to 40 % (SoC recovers, mode `SAFE`) / restores normal loads.                |

## Chaos

When the server sends `chaos` (`{enabled, duplicateRate, reorderRate, malformedRate}`), the copy of each batch put
on the wire is deliberately corrupted: events re-sent (duplicates), swapped within a batch or delayed to a later
batch (reorder), and replaced by malformed variants (NaN value, out-of-range lat, missing field, wrong type, bad
`type`). The simulator's own buffers stay clean. Injected counts are in the 10 s status log.
