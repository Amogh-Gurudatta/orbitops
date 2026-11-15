# Demo video script (about 4 minutes 30 seconds)

A shot-by-shot script for the 3 to 5 minute demo video the hackathon asks for, recorded on the **deployed site**:
<https://orbitops-web-ng32.onrender.com>. It covers each point in the brief: continuous ingestion with live
updates, several clients receiving relevant updates, history shown alongside live data, and the performance work
and unique parts of the design.

Lines in quotes are what to say. Keep them short; the screen does most of the talking. Times are targets.

## How the deployed site differs from a local run

| Thing                  | Deployed (Render free tier + MongoDB Atlas M0)                        | Local (`npm run dev`)   |
| ---------------------- | --------------------------------------------------------------------- | ----------------------- |
| Telemetry rate         | 2 samples per second per satellite, about 130 events per second       | 5 per second, about 320 |
| Simulator              | Runs inside the web service as a child process (`EMBED_SIMULATOR`)    | Separate process        |
| Latency on the console | Includes your internet round trip, so higher than local               | Same machine            |
| Sleeping               | Sleeps after 15 minutes with no visitors; waking takes about a minute | Never                   |
| History                | Raw data kept 6 hours, rollups 7 days; gaps wherever the site slept   | Same retention, no gaps |

None of this changes the script, but say the numbers you actually see, not the local ones. The high-throughput
figures (about 80,000 events per second, 10,000 viewers) come from the load tests in
[PERFORMANCE.md](PERFORMANCE.md), measured locally; quote them as that, not as what the free host is doing.

## Before you record

### Keep the site awake and full of data (1 to 2 hours before)

- Open the site and sign in at least **1 hour before recording** (2 is better), then leave that tab open. An open
  tab keeps the free service from sleeping, so the simulator keeps generating history, one-minute rollups and
  replay data.
- On the **System** page, check the `UPTIME` line under the ingest counters. If it is only a few minutes, the
  service restarted or woke recently and you have less history than you think.
- **Do not push to `main` during this window.** Render redeploys on every push, which restarts the service, clears
  any injected faults and leaves a gap in the data.
- Fleet page: 64 satellites, the `LIVE` badge, and rows updating. If the page is slow on first load, that is the
  service waking; wait for it before you start.

### One-time settings on the live site (as admin)

- **Alerts → Rules:** set `eps.busCurrentAnomaly`'s threshold to **5** if it still says 4 (the live database was
  seeded before that default changed). Otherwise the alarm log fills with routine bus-current advisories.
- **System:** chaos mode **off**. No faults active (no red rows in the fleet table). Acknowledge any leftover alarms
  so the master lamps start dark.

### Two browser windows

- Window A: signed in as `admin@orbitops.dev` (an admin can do everything an operator can).
- Window B: a private window, or another browser profile, signed in as `viewer@orbitops.dev`, so the two sessions
  have separate cookies. Place them side by side at 1920 by 1080 if you can.
- **The guided tour starts by itself** the first time each account signs in on a browser. In both windows, either
  click `SKIP TOUR` before recording, or keep it for the optional opening shot below. Once skipped or finished it
  will not come back; `shift+?` replays it.
- Window A starts on the **Satellite page for the ISS** (`/sat/25544`). Window B starts on the **Fleet page**. They
  are deliberately subscribed to different rooms.
- Close other tabs, turn off notifications, set the browser zoom to 100 percent, and hide the bookmarks bar. Sign in
  with the quick sign-on buttons; the login form allows only 5 attempts a minute per network.

### Faults to use

- **Thermal on the ISS.** The panel temperature is pulled toward 150 degrees: CAUTION at 70, WARNING at 85, usually
  within 10 to 20 seconds of injecting. It is the most visual: a clean climb through both dashed limit lines.
- **Optional second fault: battery on NOAA 19** (33591), to light a different subsystem lamp (EPS).
- Rehearse once off camera on the live site, then `CLEAR FAULT` and acknowledge the alarms.

**If the live site misbehaves on the day**, record the same script locally (`npm run dev`, then
<http://localhost:5173>) and say so in one line at the start.

## Script

### 0:00 to 0:20 — What it is

**Screen:** Window A on the Fleet page (`g` then `f`), the table filled, the globe showing the fleet.

**Say:** "This is OrbitOps: mission control for 64 real satellites, built on MongoDB, Express, React, Node and
Socket.IO, and deployed on Render with MongoDB Atlas. The orbits are real, from CelesTrak data. The telemetry is
simulated by physics: sunlight and eclipse drive the batteries and temperatures. Everything you see is arriving
live."

**Do:** Slowly point at the globe, the fleet table, and the pipeline strip across the top.

**Optional (10 seconds):** press `shift+?` and step through two tour stops, "There's a built-in guided tour for new
operators", then `SKIP TOUR`.

### 0:20 to 0:55 — Continuous ingestion

**Screen:** The pipeline strip on the Fleet page, then the **System page** (`g` then `y`).

**Say:** "A simulator pushes telemetry into the server's ingest namespace in batches every hundred milliseconds.
Each event carries a source id, a sequence number and a timestamp. The server validates it, rate limits it,
removes duplicates, puts late events back in order, then updates state and stores it in MongoDB in batches."

**Do:** Point at the ingest chart (events per second), the `ACCEPTED` counter climbing, the store flush times,
the event-loop lag, and `LAT P95` in the console bar (event-to-screen latency). Read out the numbers on screen.

**Say:** "This page is the pipeline's own instrument panel, updating once a second. On this free host it is about
130 events a second; on a laptop the same server sustained about 80,000."

### 0:55 to 1:35 — Several clients, different subscriptions

**Screen:** Both windows side by side. A on the ISS page, B on the Fleet page.

**Say:** "Here are two clients: an admin on the left and a viewer on the right. They are subscribed to different
Socket.IO rooms. The left window has the ISS's own room, which gets every sample. The right window only has the
fleet room: nine fields per satellite, once a second. Neither is sent anything it did not ask for."

**Do:** Point at the ISS traces and readouts moving in A, and the fleet rows and globe updating once a second in B.
In B, press `Ctrl+K`, type `NOAA 19`, Enter: B moves to that satellite and its subscription changes without a
reload. Go back to the Fleet page in B afterwards (`g` then `f`).

**Say:** "Updates are compact binary deltas, only the fields that changed, so each message is a fraction of the
size of plain JSON. The System page shows a real message and its size."

### 1:35 to 2:25 — Fault injection and alarms reach everyone

**Screen:** A on the ISS page, COMMANDS panel. B on the Fleet page.

**Say:** "Now let's break something. As an operator I inject a thermal fault on the ISS."

**Do:**

1. In A's COMMANDS panel, select `THERMAL`, click `INJECT FAULT`, and confirm in the dialog.
2. Watch the panel temperature trace in A climb: grey until the 70 degree line, then amber, then red past 85.
3. Point at the **CAUTION** and then **WARNING** master lamps and the `TCS` lamp flashing in the console bar of
   **both** windows, and the ISS row turning red in B's fleet table and alarm log.
4. In B (viewer), open the ISS (`Ctrl+K`, `ISS`): its COMMANDS panel reads `LOCKED`, "operator authority
   required", and there is no way to acknowledge.
5. In A, open the alarm page (`g` then `a`), select the WARNING and acknowledge it (`a`). B's lamp stops flashing
   and stays lit, without a refresh.

**Say:** "Colour appears only when something is wrong; grey is normal. The lamps flash until someone acknowledges,
like a cockpit master caution. The viewer sees the alarms but cannot act on them: roles are enforced on the
server, not just hidden in the UI. The alerts come from an anomaly engine with thresholds, rate-of-change and
statistical detectors, with hysteresis so they do not flap."

**Do:** Back on the ISS page in A, click `CLEAR FAULT`. The trace falls back and the alarms resolve on their own.

### 2:25 to 3:20 — History alongside live

**Screen:** A on the ISS page.

**Say:** "Now history. This is the live five-minute window. I will widen it."

**Do:**

1. Click `15M`, then `1H`, then `6H`, then `24H`. Pause on each long enough to see the chart redraw and the header
   line: history points, live points, duplicates dropped, and `RENDERED DUP 0`.
2. On `1H`, point at the live edge: the history trace flows into the live data with no step and no repeated points.
   On `6H` and `24H` the panel subtitle changes to `1-MIN ROLLUP`.
3. If there are hatched stretches, say so plainly: "hatched means no data, here because the free host was asleep."
4. Open **Replay** (`g` then `r`). Drag the playhead back, press play at `60×`. Point at the globe and the charts
   moving together, and the magenta `REPLAY` badge in the console bar. Click `LIVE` to return.
5. Open **Analytics** (`g` then `n`). Click a cell in the heatmap to load that satellite's study, with its history,
   24-hour baseline band and live tail in one chart.

**Say:** "Short ranges come from raw MongoDB records, longer ones from one-minute rollups, always downsampled to
what the screen can show. The server tells the browser the last sequence number it returned, and the browser drops
any live event at or below that mark. That is how history and live join with no duplicates and no gaps. The same
data powers replay and analytics."

### 3:20 to 4:05 — Defences: chaos mode

**Screen:** System page in A (admin).

**Say:** "Real networks duplicate, reorder and corrupt messages. Let's make the simulator do that on purpose."

**Do:** In the DEFENCES panel, switch `CHAOS` on with the default rates (0.05 duplicates, 0.1 reordering, 0.02
malformed) and click `APPLY`. Point at the `DUPLICATES`, `OUT OF ORDER` and `MALFORMED` counters climbing within
seconds. Switch to the ISS page in A and show the charts are still clean: no spikes, no repeats.

**Say:** "The pipeline catches every one of them and counts them. Duplicates are dropped, out-of-order events are
put back in sequence, malformed ones are rejected. Each producer has a rate limit, and when the server is busy it
tells the producer to back off in its acknowledgement. A browser that cannot keep up is first dropped to the slow
feed, then disconnected, so one bad client cannot hurt the others."

**Do:** Back on the System page, switch chaos **off** and click `APPLY`.

### 4:05 to 4:30 — What makes it different, and wrap-up

**Screen:** Fleet page in both windows, or a quick cut across the pages.

**Say:** "Three things make this different. The data is real orbital mechanics, not random numbers. The browser does
its socket work in a Web Worker and redraws through a single animation-frame loop, so a flood of messages cannot
cause a flood of renders. And the interface follows control-room rules: grey is normal, colour means abnormal. It's
live on Render, and the repository has the architecture, the real-time design, the tests and the load-test results.
Thanks for watching."

**Do:** End on the Fleet page with both windows live.

## After recording

- `CLEAR FAULT` on every satellite you faulted and acknowledge the alarms.
- Confirm chaos is **off** on the System page and the duplicate, out-of-order and malformed counters have stopped.
- Leave the site alone for judging; it will sleep when idle and wake on the first visit.

## If you run short or long

- **Cut to fit 3 minutes:** skip the optional tour shot, the analytics heatmap, the NOAA 19 subscription change,
  and the closing summary.
- **Add if under 4 minutes:** show **Ground stations** (`g` then `g`): the stations' in-view counts, the coverage
  globe, and the 12-hour pass timeline with the countdown to the next pass.
- If an alarm is slow to appear, say "the model pulls the panel toward 150 degrees" and carry on; alerts open after
  three consecutive samples past the limit, which at 2 samples a second is about a second and a half.
- If something looks wrong live, do not hide it: the System page counters show what the pipeline did, which is the
  point of the project.

## Checklist of what the brief asks to see

| The brief asks for                          | Where in this script                                     |
| ------------------------------------------- | -------------------------------------------------------- |
| Primary functionality                       | 0:00 to 2:25                                             |
| Continuous ingestion and live updates       | 0:20 to 0:55, and throughout                             |
| Multiple clients receiving relevant updates | 0:55 to 1:35, and the alarm propagation at 1:35 to 2:25  |
| Historical data alongside live telemetry    | 2:25 to 3:20                                             |
| Performance optimisations, unique aspects   | 0:55 to 1:35, 3:20 to 4:05, 4:05 to 4:30                 |
| Hosting (bonus)                             | 0:00 to 0:20 and 4:05 to 4:30, recorded on the live site |
