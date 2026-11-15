# Demo video script (about 4 minutes)

Record on the live site: <https://orbitops-web-ng32.onrender.com>

Say the short lines in quotes. Read numbers off the screen rather than memorising them.

## Before you record

1. **Wake the site and leave it open for 1 to 2 hours.** An open tab keeps the free host awake, so it builds up the
   history the demo needs. Don't push to `main` in that time, because every push restarts the site.
2. **Open two windows.** Window A: sign in as `admin@orbitops.dev`. Window B (private window): sign in as
   `viewer@orbitops.dev`. Password for both: `orbitops`. Use the quick sign-on buttons.
3. **Skip the guided tour** in both windows (`SKIP TOUR`). It starts by itself on first sign-in.
4. **Check the starting state:** chaos is off (System page), no red rows in the fleet table, and no unacknowledged
   alarms.
5. Window A on the ISS page (`/sat/25544`). Window B on the Fleet page.

## Script

### 1. What it is (0:00 to 0:20)

**Show:** Window A on the Fleet page.

**Say:** "OrbitOps is mission control for 64 real satellites, built with MongoDB, Express, React, Node and Socket.IO.
The orbits are real. The telemetry is simulated from physics. It's all live."

### 2. Live data coming in (0:20 to 0:50)

**Show:** System page (`g` then `y`).

**Say:** "A simulator streams telemetry to the server. The server checks it, removes duplicates, fixes the order,
stores it in MongoDB and broadcasts it. This page shows that pipeline live."

**Do:** Point at the events per second chart, the accepted counter and the latency in the top bar.

### 3. Two clients, different data (0:50 to 1:30)

**Show:** Both windows side by side.

**Say:** "Two clients, subscribed to different Socket.IO rooms. The admin on the left gets every update for the
ISS. The viewer on the right only gets the fleet summary, once a second. Neither receives data it didn't ask for."

**Do:** Point at the moving ISS charts in A and the fleet table in B.

### 4. Break something (1:30 to 2:20)

**Show:** Window A, ISS page, COMMANDS panel.

**Say:** "Let's inject a fault."

**Do:**

1. Choose `THERMAL`, click `INJECT FAULT`, confirm.
2. Watch the panel temperature climb: amber, then red.
3. Point at the flashing WARNING lamp in **both** windows.
4. In B, open the ISS: the COMMANDS panel is `LOCKED` for a viewer.
5. In A, open alarms (`g` then `a`) and press `a` to acknowledge. B's lamp stops flashing.
6. Back on the ISS page, click `CLEAR FAULT`.

**Say:** "Colour only appears when something is wrong. Viewers can see alarms but can't change anything. That's
enforced on the server."

### 5. History plus live (2:20 to 3:10)

**Show:** Window A, ISS page.

**Do:** Click `15M`, then `1H`, then `6H`. Point at the header counts: `RENDERED DUP 0`. Then open Replay
(`g` then `r`), press play, and click `LIVE` to return.

**Say:** "Widening the range loads history from MongoDB and joins it to the live stream with no duplicates and no
gaps. Replay uses the same data."

### 6. Chaos mode (3:10 to 3:40)

**Show:** System page, Window A.

**Do:** Switch `CHAOS` on and click `APPLY`. Point at the duplicate, out-of-order and malformed counters climbing.
Then switch it off and click `APPLY`.

**Say:** "Now the simulator sends duplicate, reordered and broken messages on purpose. The server catches them all,
and the charts stay clean."

### 7. Wrap up (3:40 to 4:00)

**Show:** Fleet page.

**Say:** "Real orbits, a pipeline built for high-frequency data, a browser that doesn't choke on it, and a
control-room style interface. It's live on Render. The repo has the architecture docs and load-test results.
Thanks for watching."

## After recording

Clear any faults, acknowledge alarms, and make sure chaos is off.

## If something goes wrong

- **Site is slow:** it was asleep. Wait a minute and try again.
- **An alarm is slow to appear:** keep talking, it only takes a few seconds.
- **Live site is broken on the day:** record the same script locally (`npm run dev`, then
  <http://localhost:5173>) and say so at the start.
