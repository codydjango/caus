## Context

The prototype spec defines a TypeScript/Node 22 stack (`tsx`, strict ESM, Vitest). The existing OpenSpec specs (`event-sourcing`, `world-clock`, `site-actions`) define the full behavioral contract. `src/index.ts` is a hello-world stub. The stack already has `better-sqlite3` available (or will after one `npm install`). No HTTP server, no frontend — this change is backend-only: event store, clock, aggregates, projections, commands.

## Goals / Non-Goals

**Goals:**
- Pass all scenarios in the three existing OpenSpec specs as Vitest tests
- Implement the full event envelope (all required fields from `event-sourcing` spec)
- Monotonic world clock with persisted origin surviving process restarts
- `WorldTickAdvanced` tick loop with integer-second catch-up
- Player and Site projections rebuilt from the event log on demand
- `BuildFarm`, `UpgradeFarm`, `GiveMoney` commands with optimistic concurrency
- Cross-aggregate `UpgradeFarm` with `MoneyRefunded` compensation on conflict
- System-triggered `FarmBuildCompleted` / `FarmUpgradeCompleted` from the tick loop

**Non-Goals:**
- HTTP server, WebSocket push, or frontend
- Temporal verbs (speedup, slowdown, rollback, force-forward)
- CP / Chronite Points — not in scope for this slice
- Snapshotting, event store optimization
- Multi-process or distributed concerns

## Decisions

### `better-sqlite3` (synchronous API)
**Chosen over** async alternatives (`sqlite3`, `@databases/sqlite`).
All game logic in this slice is single-threaded and local; synchronous DB calls eliminate async ceremony in projection rebuild and command validation loops. Concurrency in the prototype is not a concern.

### World clock origin persisted in a `meta` table
**Chosen over** using wall-clock time as the origin or storing in a file.
The `world-clock` spec requires that the clock survive process restarts without "rewinding" or "skipping." Storing the hrtime origin offset in SQLite alongside the event log keeps everything in one file and avoids filesystem sync issues.

Concretely: on startup, read `meta.world_origin_wall_ms` (the wall-clock ms when the world was first started). `WorldClock.now()` = `BigInt(Date.now()) - BigInt(origin_wall_ms)` converted to microseconds using `process.hrtime.bigint()` for within-process precision, then anchored to wall-clock on restart.

### Full projection rebuild on every query
**Chosen over** incremental in-memory state or snapshots.
At prototype scale (hundreds of events), rebuilding from SQLite is fast. No risk of projection drift. Snapshots can be added later if tick-loop latency becomes measurable.

### Optimistic concurrency via `aggregate_version` in the events table
**Chosen over** row-level locks or separate version table.
A `version` column on each event row, combined with a `CHECK` constraint (via application-level enforcement), is sufficient for a single-process prototype. The spec requires detecting version conflicts; this approach does so with a simple `MAX(version) + 1` check before each insert.

### Tick loop at 100ms wake interval checking for crossed integer-second boundaries
**Chosen over** a 1 000ms interval.
A 100ms loop detects integer-second crossings within 100ms of their occurrence, which is imperceptible in gameplay. It also makes the catch-up logic (emit one tick per crossed boundary) straightforward. The loop is cheap — it's a `SELECT MAX(tick_number) FROM events WHERE event_type = 'WorldTickAdvanced'` check.

### Cross-aggregate `UpgradeFarm` uses sequential appends with compensating event
**Chosen over** a saga coordinator or two-phase commit.
The spec explicitly mandates this pattern. Sequence: (1) validate both aggregates, (2) append `MoneySpent` to Player, (3) append `FarmUpgradeStarted` to Site — if step 3 fails due to a concurrency conflict, append `MoneyRefunded` to Player. Both events in step 2+3 share a `correlation_id`; causation chain is maintained.

## Risks / Trade-offs

Single-process synchronous SQLite blocks during writes → Mitigation: writes are short (one small row); acceptable for a local prototype with no concurrent clients.

World clock origin tied to wall clock means large NTP jumps (unlikely on dev hardware) could skew elapsed time on restart → Mitigation: this is a prototype; document the limitation. The spec's monotonic requirement only applies within a single process run (the restart scenario uses wall-clock anchoring by design).

Full rebuild projection called per tick at 100ms → Mitigation: profile if sluggish; add in-memory projection cache behind `buildProjection` if needed.

## Open Questions

- Should `WorldClock.now()` return microseconds (bigint) or milliseconds (number)? The spec says "microsecond precision." Store as bigint internally, expose as number of microseconds?
- Tick event `world_clock_at` stores the crossed integer-second value or the actual time of appending?
