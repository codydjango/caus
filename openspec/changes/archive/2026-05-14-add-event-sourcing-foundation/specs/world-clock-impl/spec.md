## ADDED Requirements

### Requirement: World clock origin persisted in meta table
The system SHALL persist the world clock origin in a `meta` table in the same SQLite database. The `meta` table SHALL store `key`/`value` pairs. On first startup, the system SHALL write `world_origin_wall_ms` (current `Date.now()` value) to `meta`. On subsequent startups, the system SHALL read this value and use it to compute elapsed time. This ensures `WorldClock.now()` never rewinds across process restarts.

#### Scenario: Origin written on first startup
- **WHEN** the database has no `world_origin_wall_ms` key in `meta`
- **THEN** the current `Date.now()` is written to `meta` and used as the origin

#### Scenario: Origin reused on restart
- **WHEN** `world_origin_wall_ms` already exists in `meta`
- **THEN** the stored value is used as the origin; no new value is written

### Requirement: WorldClock.now() returns microseconds as bigint
The system SHALL export a `WorldClock` object with a `now()` method returning the elapsed microseconds since the world origin as a `bigint`. Within a single process run, the value SHALL be derived from `process.hrtime.bigint()` for sub-millisecond precision. Across restarts, the value SHALL be anchored to the wall-clock difference from the stored origin.

#### Scenario: Monotonic within a process run
- **WHEN** `WorldClock.now()` is called twice in succession within the same process
- **THEN** the second call returns a value strictly greater than the first

#### Scenario: Approximate continuity across restarts
- **WHEN** the process restarts after running for D milliseconds
- **THEN** `WorldClock.now()` immediately after restart returns a value close to D × 1000 microseconds (within one tick interval of wall-clock error)

### Requirement: Tick loop emits WorldTickAdvanced at integer-second boundaries
The system SHALL export `startTickLoop()` that begins a `setInterval` at 100ms. Each invocation SHALL check how many integer-second boundaries have been crossed since the last `WorldTickAdvanced` event was emitted, and SHALL append one `WorldTickAdvanced` event per crossed boundary in order.

The `WorldTickAdvanced` payload SHALL include `tick_number` (integer seconds since world start).

#### Scenario: Single tick emitted when one boundary is crossed
- **WHEN** the world clock crosses the 5-second boundary
- **THEN** one `WorldTickAdvanced { tick_number: 5 }` event is appended

#### Scenario: Catch-up emits multiple ticks in order
- **WHEN** the tick loop wakes up after crossing boundaries 10, 11, and 12
- **THEN** three `WorldTickAdvanced` events are appended: tick_number 10, 11, 12 in that order

#### Scenario: No duplicate ticks
- **WHEN** the tick loop runs multiple times within the same integer-second window
- **THEN** no additional `WorldTickAdvanced` event is appended for that second

### Requirement: world_clock_at set from WorldClock.now() at append time
Every call to `appendEvent` SHALL capture `WorldClock.now()` (as a number of microseconds, cast to a safe integer for SQLite storage) at the moment of the call and store it in `world_clock_at`. Callers SHALL NOT provide `world_clock_at` — it is always set by the store.

#### Scenario: world_clock_at populated automatically
- **WHEN** a command handler calls `appendEvent` without specifying `world_clock_at`
- **THEN** the persisted event's `world_clock_at` reflects the time of the call, not a caller-supplied value
