# Demo video script (about 4 minutes 30 seconds)

A shot-by-shot script for the 3 to 5 minute demo video the hackathon asks for. It covers each point in the brief:
continuous ingestion with live updates, several clients receiving relevant updates, history shown alongside live
data, and the performance work and unique parts of the design.

Lines in quotes are what to say. Keep them short; the screen does most of the talking. Times are targets.

## Before you record

**Stack and data**

- Start the full stack ([DEPLOYMENT.md](DEPLOYMENT.md)) at least **30 minutes before recording**, ideally an hour, so
  history, one-minute rollups, the analytics heatmap and the replay all have something to show. Raw data is kept
  for 6 hours by default.
- Confirm the simulator is running at the normal rate and the Fleet page shows 64 satellites and the LIVE badge.
- Make sure chaos mode is **off** and no faults are active (fleet table has no red rows). If an old alarm is still
  unacknowledged from testing, acknowledge it so the lamps start dark.

**Two browser windows**

- Window A: signed in as `admin@orbitops.dev` (an admin can do everything an operator can).
- Window B: a private window, or another browser, signed in as `viewer@orbitops.dev`, so the sessions have
  separate cookies. Place them side by side at 1920 by 1080 if you can.
- Window A starts on the **Satellite page for the ISS (25544)**. Window B starts on the **Fleet page**. They are
  deliberately subscribed to different rooms.
- Close other tabs, turn off notifications, set the browser zoom to 100 percent, and hide the bookmarks bar.

**Faults to use**

- **Thermal on the ISS** (`panelTempC` heads for 150 degrees: a CAUTION at 70 degrees, then a WARNING at 85
  degrees, within seconds of injecting; confirm the timing in your rehearsal). It is the most visual: a clean climb
  through both dashed limit lines.
- **Optional second fault: battery on NOAA 19**, if there is time, to show a different subsystem lamp.
- Practice once off camera and clear the faults afterwards.

**After recording**

- Clear all faults (`CLEAR`) and acknowledge the alarms.
- Switch chaos **off** (System page, admin) and confirm the duplicate, out-of-order and malformed counters stop.

## Script

### 0:00 to 0:20 — What it is

**Screen:** Window A on the Fleet page, globe turning slowly, the table filled.

**Say:** "This is OrbitOps: mission control for 64 real satellites, built on MongoDB, Express, React, Node and
Socket.IO. The orbits are real, from CelesTrak data. The telemetry is simulated by physics: sunlight and eclipse
drive the batteries and temperatures. Everything you see is arriving live."

**Do:** Slowly point at the globe, the fleet table, and the pipeline strip across the top.

### 0:20 to 0:55 — Continuous ingestion

**Screen:** The pipeline strip on the Fleet page, then the **System page** (SYS).

**Say:** "A simulator process pushes telemetry into the server's ingest namespace, in batches every hundred
milliseconds. Each event carries a source id, a sequence number and a timestamp. The server validates it, rate
limits it, removes duplicates, puts late events back in order, then updates state and stores it in MongoDB in
batches."

**Do:** Open SYS (hotkey `g` then `y`). Point at the ingest chart (events per second), the **accepted** counter
climbing, the store flush times, and **LAT P95** (event-to-screen latency). Mention the numbers you actually see.

**Say:** "This page is the pipeline's own instrument panel, updating once a second."

### 0:55 to 1:35 — Several clients, different subscriptions

**Screen:** Both windows side by side. A on the ISS page, B on the Fleet page.

**Say:** "Here are two clients, an admin on the left and a viewer on the right. They are subscribed to different
Socket.IO rooms. The left window has the ISS's own room, at up to ten updates a second. The right window only has
the fleet room, which carries nine fields per satellite once a second. Neither is sent anything it did not ask for."

**Do:** Point at the ISS traces moving smoothly in A, and the rows and globe updating more slowly in B. Switch B to
a different satellite (`Ctrl+K`, type NOAA 19, Enter) to show its subscription change without reloading.

**Say:** "Updates are compact binary deltas, only the fields that changed, so each message is a fraction of the
size of plain JSON."

### 1:35 to 2:25 — Fault injection and alarms reach everyone

**Screen:** A on the ISS page, Commands panel. B still on Fleet (or on the alarm page).

**Say:** "Now let's break something. As an operator I inject a thermal fault on the ISS."

**Do:**

1. In A, choose `THERMAL` in the Commands panel, press inject, and confirm.
2. Watch the panel temperature trace in A climb. It stays grey until the 70 degree limit, then turns amber; at 85
   it turns red.
3. Point to the **CAUTION** and then **WARNING** lamps flashing in the console bar of **both** windows, and the
   `TCS` subsystem lamp.
4. In B (viewer), show that the Commands panel reads `LOCKED` and the acknowledge button is disabled.
5. In A, open the alarm page (`g` then `a`), acknowledge the alarm. Show B's lamp change from flashing to steady
   without a refresh.

**Say:** "Colour appears only when something is wrong. Grey is normal. The lamps flash until someone acknowledges,
like a cockpit master caution. The viewer sees the alarms but cannot acknowledge them: roles are enforced on the
server, not just hidden in the UI. The alerts come from an anomaly engine with thresholds, rate-of-change and
statistical detectors, and hysteresis so they do not flap."

**Do:** Click `CLEAR` in A and show the trace falling, the alerts resolving.

### 2:25 to 3:20 — History alongside live

**Screen:** A on the ISS page.

**Say:** "Now history. This is the live five-minute window. I will widen it."

**Do:**

1. Click `15M`, then `1H`, then `6H`, then `24H`. Pause on each long enough to see the chart redraw and the header
   counters (history points, live points, duplicates dropped).
2. Point at the live edge on the `1H` view: the trace flows into the live data with no step, no repeated points.
3. Open the **Replay** page (`g` then `r`). Drag the scrubber back, press play at `60x`. Point at the globe and the
   charts moving together, and the magenta `REPLAY` badge.
4. Open **Analytics** (`g` then `n`). Click a hot cell in the heatmap, show the satellite study against its
   24-hour baseline.

**Say:** "Short ranges come from raw MongoDB records, longer ones from one-minute rollups, always downsampled to
what the screen can show. The server tells the browser the last sequence number it read, and the browser drops any
live event at or below that mark. That is how history and live join with no duplicates and no gaps. The same data
powers replay and analytics."

### 3:20 to 4:05 — Defences: chaos mode

**Screen:** SYS page in A (admin).

**Say:** "Real networks duplicate, reorder and corrupt messages. Let's make the simulator do that on purpose."

**Do:** Switch **CHAOS** on with the default rates (5 percent duplicates, 10 percent reordering, 2 percent
malformed). Point at the **duplicates**, **out of order** and **malformed** counters climbing within seconds. Switch
to the satellite page in B (or A) and show the charts are still clean: no spikes, no repeats.

**Say:** "The pipeline catches every one of them, and counts them. Duplicates are dropped, out-of-order events are
put back in sequence, malformed ones are rejected. Each producer has a rate limit, and when the server gets busy it
tells the producer to slow down in its acknowledgement. A browser that cannot keep up is first dropped to the slow
feed, then disconnected, so one bad client cannot hurt the others."

**Do:** Switch chaos **off**.

### 4:05 to 4:30 — What makes it different, and wrap-up

**Screen:** Fleet page in both windows, or a quick cut across the six pages.

**Say:** "Three things make this different. The data is real orbital mechanics, not random numbers. The browser
does its socket work in a Web Worker and redraws through a single animation-frame loop, so a flood of messages
cannot cause a flood of renders. And the interface follows control-room rules: grey is normal, colour means
abnormal. The repository has the architecture, the real-time design, the test suite, and load-test results.
Thanks for watching."

**Do:** End on the Fleet page with both windows live.

## If you run short or long

- **Cut to fit 3 minutes:** skip the analytics heatmap, the second subscription change, and the closing summary.
- **Add if under 4 minutes:** show the Ground stations page (`g` then `g`): the pass timeline and the countdown to
  the next pass.
- If an alarm is slow to appear, say "the model pulls the panel toward 150 degrees" and carry on; alerts open
  after a few consecutive samples beyond the limit.
- If something looks wrong live, do not hide it: the System page counters show what the pipeline did, which is the
  point of the project.

## Checklist of what the brief asks to see

| The brief asks for                          | Where in this script                                    |
| ------------------------------------------- | ------------------------------------------------------- |
| Primary functionality                       | 0:00 to 2:25                                            |
| Continuous ingestion and live updates       | 0:20 to 0:55, and throughout                            |
| Multiple clients receiving relevant updates | 0:55 to 1:35, and the alarm propagation at 1:35 to 2:25 |
| Historical data alongside live telemetry    | 2:25 to 3:20                                            |
| Performance optimisations, unique aspects   | 0:55 to 1:35, 3:20 to 4:05, 4:05 to 4:30                |
