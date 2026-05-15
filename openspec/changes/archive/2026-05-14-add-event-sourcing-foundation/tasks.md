## 1. Dependencies and Project Setup

- [x] 1.1 Add `better-sqlite3` to `package.json` dependencies and run `npm install`
- [x] 1.2 Add `@types/better-sqlite3` to dev dependencies
- [x] 1.3 Create `data/` directory and add `data/*.db` to `.gitignore`
- [x] 1.4 Create `src/db/`, `src/domain/`, `src/commands/` directory structure

## 2. World Clock

- [x] 2.1 Create `src/domain/clock.ts`: implement `WorldClock` with `init(db)` (reads or writes `world_origin_wall_ms` in `meta` table) and `now()` returning microseconds as `bigint`
- [x] 2.2 Ensure `WorldClock.now()` uses `process.hrtime.bigint()` for within-process precision, anchored to wall-clock on restart
- [x] 2.3 Write Vitest tests: monotonic within a run, approximate continuity after simulated restart (mock origin)

## 3. Event Store

- [x] 3.1 Create `src/db/store.ts`: open (or create) SQLite DB, create `meta` and `events` tables if they don't exist
- [x] 3.2 Define the `EventEnvelope` TypeScript type with all required fields (event_id, event_type, aggregate_type, aggregate_id, aggregate_version, world_clock_at, wall_clock_at, correlation_id, causation_id, scope_tags, payload)
- [x] 3.3 Define TypeScript discriminated union for all event types: `FarmBuildStarted`, `FarmBuildCompleted`, `FarmUpgradeStarted`, `FarmUpgradeCompleted`, `MoneyReceived`, `MoneySpent`, `MoneyRefunded`, `WorldTickAdvanced`
- [x] 3.4 Implement `appendEvent(event)`: sets `world_clock_at` from `WorldClock.now()` and `wall_clock_at` from `Date.now()`, generates `event_id` (UUID via `crypto.randomUUID()`), enforces optimistic concurrency (throws `ConcurrencyError` on version mismatch)
- [x] 3.5 Implement `readEvents()`: returns all events ordered by `world_clock_at` ASC
- [x] 3.6 Implement `readEventsByAggregate(aggregateType, aggregateId)`: returns events for one aggregate ordered by `aggregate_version` ASC
- [x] 3.7 Write Vitest tests: append + read, optimistic concurrency rejection (stale version), aggregate-scoped read isolation

## 4. Player Aggregate

- [x] 4.1 Define `PlayerState` type: `{ money: number }`
- [x] 4.2 Implement `buildPlayerProjection(events: EventEnvelope[]): PlayerState` in `src/domain/player.ts`
- [x] 4.3 Implement `handleGiveMoney({ playerId, amount })` in `src/commands/giveMoney.ts`: validate amount > 0, compute next version, append `MoneyReceived` event
- [x] 4.4 Write Vitest tests: projection after credits/debits/refunds, empty aggregate returns zero, GiveMoney success and rejection

## 5. Site Aggregate

- [x] 5.1 Define `SiteState` type: `{ has_farm, level, build_in_progress, upgrade_in_progress }`
- [x] 5.2 Implement `buildSiteProjection(events: EventEnvelope[]): SiteState` in `src/domain/site.ts`
- [x] 5.3 Implement `handleBuildFarm({ siteId })` in `src/commands/buildFarm.ts`: validate empty site, append `FarmBuildStarted` with `completes_at_world_clock = started_at + 30_000_000n`
- [x] 5.4 Write Vitest tests: projection states (empty, in-progress, completed, multiple upgrades), BuildFarm success and all rejection cases

## 6. Cross-Aggregate UpgradeFarm Command

- [x] 6.1 Implement `handleUpgradeFarm({ siteId, playerId })` in `src/commands/upgradeFarm.ts`
- [x] 6.2 Step 1–2: read both projections and validate (farm exists, no upgrade in progress, sufficient money)
- [x] 6.3 Step 3–4: generate `correlation_id`, append `MoneySpent` to Player aggregate
- [x] 6.4 Step 5: append `FarmUpgradeStarted` to Site aggregate with `causation_id = MoneySpent.event_id` and `completes_at_world_clock = started_at + 120_000_000n`
- [x] 6.5 Step 6: on `ConcurrencyError` from step 5, append `MoneyRefunded` to Player aggregate with same `correlation_id`
- [x] 6.6 Write Vitest tests: success path (both events appended, causation chain correct), all validation rejections, compensation path (mock concurrency failure on Site)

## 7. Tick Loop

- [x] 7.1 Create `src/domain/tick.ts`: implement `startTickLoop(db)` using `setInterval` at 100ms
- [x] 7.2 Each invocation: find last emitted tick number from event log, compute how many integer-second boundaries have been crossed, append one `WorldTickAdvanced` per crossed boundary in order
- [x] 7.3 After tick events: check for due `FarmBuildCompleted` — if `FarmBuildStarted` exists without completion and `completes_at_world_clock <= WorldClock.now()`, append `FarmBuildCompleted` with correct `causation_id`
- [x] 7.4 Check for due `FarmUpgradeCompleted` — same pattern as build completion
- [x] 7.5 Write Vitest tests: catch-up emits multiple ticks in order, no duplicate ticks, build completion fires correctly, completion is idempotent

## 8. Wiring and Smoke Test

- [x] 8.1 Update `src/index.ts` to: open DB, init WorldClock, start tick loop, run a smoke-test sequence (GiveMoney → BuildFarm → wait for completion → UpgradeFarm) and print projection state
- [x] 8.2 Run `make start` and verify the smoke-test output shows correct state transitions
- [x] 8.3 Run `make test-run` — all Vitest tests pass
- [x] 8.4 Run `make typecheck` — zero TypeScript errors
