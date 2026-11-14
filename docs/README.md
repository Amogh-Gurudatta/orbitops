# OrbitOps documentation

OrbitOps is a real-time satellite mission-control platform built on the MERN stack and Socket.IO. A fleet of
simulated spacecraft streams telemetry into a staged ingest pipeline; the server keeps live state, detects
anomalies, stores history in MongoDB, and fans out compact updates to browsers. This folder explains how it
works, how to run it, and how it was tested.

## Where to start

| If you want to...                                       | Read                               |
| ------------------------------------------------------- | ---------------------------------- |
| Understand the whole system in ten minutes              | [ARCHITECTURE.md](ARCHITECTURE.md) |
| See the real-time mechanism in depth                    | [REALTIME.md](REALTIME.md)         |
| Look up a collection, field, index or TTL               | [DATA_MODEL.md](DATA_MODEL.md)     |
| Call a REST endpoint or subscribe over Socket.IO        | [API.md](API.md)                   |
| Know what the simulated data is and where it comes from | [SIMULATION.md](SIMULATION.md)     |
| Review authentication, roles and abuse protection       | [SECURITY.md](SECURITY.md)         |
| Run it locally, in Docker, or deploy it on Render       | [DEPLOYMENT.md](DEPLOYMENT.md)     |
| Run the tests or reproduce the demo checks              | [TESTING.md](TESTING.md)           |
| See load-test numbers and performance results           | [PERFORMANCE.md](PERFORMANCE.md)   |
| See the visual language of the UI                       | [UI design system](DESIGN.md)      |

## Mapping to the hackathon's design-document request

The problem statement asks for four things in an optional design document. Each has a home here.

| Requested item                                                   | Where                                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| System architecture diagram                                      | [ARCHITECTURE.md, component diagram](ARCHITECTURE.md#component-diagram)                                         |
| Data flow diagram (ingestion, processing, storage, broadcasting) | [ARCHITECTURE.md, data flow](ARCHITECTURE.md#data-flow)                                                         |
| Database schema or data model                                    | [DATA_MODEL.md](DATA_MODEL.md)                                                                                  |
| Real-time communication and performance techniques               | [REALTIME.md](REALTIME.md), with the checklist in [REALTIME.md](REALTIME.md#performance-optimisation-checklist) |

## Conventions used in these documents

- Every number (interval, limit, size) was read from the code or its configuration. Where a value can be
  changed by an environment variable, the default is shown and the variable is named.
- Code paths are relative links so they work on GitHub.
- "Satellite id" (`satId`) is the NORAD catalogue number. "Source id" (`sourceId`) is the string `sat-<noradId>`
  that identifies a telemetry producer on the wire.
- Timestamps are epoch milliseconds on the wire and `Date` objects in MongoDB.
- Documents describe what the code does today. Known gaps are called out explicitly in the "limitations"
  sections rather than hidden.
