## Why

The project has a detailed prototype spec and three fully-written OpenSpec specs (`event-sourcing`, `world-clock`, `site-actions`) but `src/index.ts` is an empty stub. This change implements the foundational event-sourcing layer — the SQLite event log, world clock, aggregates, projections, and core commands — so the game loop can run and all three specs can be validated against real code.

## What Changes

- Add SQLite-backed append-only event log with the full envelope defined in the `event-sourcing` spec
- Implement world clock using Node's `process.hrtime.bigint()` for microsecond-precision monotonic time with a persisted origin so it survives process restarts (per `world-clock` spec)
- Add background tick loop emitting `WorldTickAdvanced` events at integer-second boundaries, including catch-up for delayed loops
- Implement `Player` and `Site` aggregate projections rebuilt from the event log on demand
- Add command handlers for `BuildFarm`, `UpgradeFarm`, `GiveMoney` with full validation and cross-aggregate sequencing (including compensating events on failure)
- Add system-triggered completion handlers: `FarmBuildCompleted` and `FarmUpgradeCompleted` fired by the tick loop when `completes_at_world_clock` is reached
- Add Vitest tests covering the event store, projections, and all command handlers

## Capabilities

### New Capabilities

- `event-store`: Implements the `event-sourcing` spec — append-only SQLite event log, full envelope, optimistic concurrency, aggregate-scoped reads
- `world-clock-impl`: Implements the `world-clock` spec — monotonic hrtime origin, persisted across restarts, microsecond precision, integer-second tick events with catch-up
- `player-aggregate`: Player projection (money balance) and command handlers (`GiveMoney`)
- `site-aggregate`: Site projection (farm state, build/upgrade timers) and command handlers (`BuildFarm`, `UpgradeFarm`) with system-triggered completions
- `cross-aggregate-commands`: `UpgradeFarm` sequencing across Player + Site with compensating `MoneyRefunded` event on Site concurrency failure

### Modified Capabilities

## Impact

- `src/` — all new; replaces the hello-world stub
- `tests/` — new test files covering each capability
- New runtime dependency: `better-sqlite3`
- New dev dependencies: `@types/better-sqlite3`, `@types/node` (if not already present)
- `package.json` and `tsconfig.json` may need minor updates (e.g., enabling `"moduleResolution": "bundler"` or bigint support)
