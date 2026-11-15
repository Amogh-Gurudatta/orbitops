# Demo video script (about 3 minutes)

Record on the live site: <https://orbitops-web-ng32.onrender.com>

Setup: Window A signed in as `admin@orbitops.dev`, Window B (private window) as `viewer@orbitops.dev`. Password for
both is `orbitops`. Click `SKIP TOUR` in both. Start on the Fleet page.

## 1. What it is (20 s)

**Say:** "OrbitOps is live mission control for 64 real satellites, built with MongoDB, Express, React, Node and
Socket.IO. The orbits are real. The data is simulated from physics."

**Show:** the Fleet page: globe, fleet table, alarm log.

## 2. Live data pipeline (30 s)

**Do:** press `g` then `y` for the System page.

**Say:** "A simulator streams data into the server. The server validates it, removes duplicates, stores it in
MongoDB and sends it to every browser. This page shows that pipeline live."

## 3. Two users, different data (30 s)

**Do:** put the two windows side by side. A on the ISS page, B on the Fleet page.

**Say:** "Two users, each subscribed to different data. The admin gets every ISS update. The viewer only gets a
fleet summary once a second. Nobody gets data they didn't ask for."

## 4. Break something (50 s)

**Do:** in A, on the ISS page, choose `THERMAL`, click `INJECT FAULT`, confirm. Watch the temperature turn amber
then red, and the WARNING lamp flash in both windows. Then click `CLEAR FAULT`.

**Say:** "I inject a fault. Colour only appears when something is wrong. Both users see the alarm at the same time.
The viewer can't act on it, because permissions are enforced on the server."

## 5. History and live together (30 s)

**Do:** click `15M`, then `1H`. Point at `RENDERED DUP 0`.

**Say:** "Longer ranges load history from MongoDB and join it to the live data, with no duplicates and no gaps."

## 6. Close (20 s)

**Say:** "It's deployed on Render, with architecture docs and load-test results in the repo. Thanks for watching."

**Before you stop:** clear any faults.
