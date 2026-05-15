# World Clock

The authoritative game time source. Every event in the system carries a world clock value used for ordering and (in future slices) temporal queries.

## Requirements

### Requirement: Always-On World Clock

The world clock MUST advance continuously from the moment the world is created. There is no pause, no maintenance pause, no per-session pause.

#### Scenario: Clock advances during normal operation

- GIVEN the world has been created
- WHEN time passes
- THEN `WorldClock.now()` returns a value strictly greater than at any earlier moment

#### Scenario: Clock advances during player inactivity

- GIVEN no player commands are being issued
- WHEN time passes
- THEN the world clock continues to advance at the same rate

### Requirement: Monotonic Source

The world clock MUST be derived from the operating system's monotonic clock, not from wall-clock time. The clock MUST NOT decrease, even if the wall clock is corrected backward by NTP or other means.

#### Scenario: Wall clock correction does not affect world clock

- GIVEN the world clock is reading value V
- WHEN the OS wall clock is corrected backward by some amount
- THEN the next reading of the world clock is strictly greater than V

### Requirement: World Clock Origin

The system MUST capture the monotonic clock value at world creation as the origin. World clock values are computed as the elapsed monotonic time since that origin.

#### Scenario: World begins at clock value zero

- GIVEN the world has just been created
- WHEN `WorldClock.now()` is called immediately
- THEN the value is at or near zero

#### Scenario: World clock origin persists across process restarts

- GIVEN the world has been running for some time
- WHEN the world process restarts
- THEN the world clock origin is recovered such that the post-restart world clock value reflects the elapsed time correctly (i.e., the world does not appear to have "rewound" or "skipped ahead" to an inconsistent value)

### Requirement: Precision

The world clock MUST provide at least microsecond precision, stored as a numeric type with sufficient precision to order events that occur within the same wall-clock millisecond.

#### Scenario: Events within the same millisecond are ordered

- GIVEN two events are appended within the same wall-clock millisecond
- WHEN their `world_clock_at` values are compared
- THEN the values are distinct and reflect their order of appending

### Requirement: World Clock On Every Event

Every event appended to the log MUST have its `world_clock_at` value set at the moment of appending, using `WorldClock.now()`. The value MUST NOT be recomputed during replay or projection.

#### Scenario: Event timestamp is captured at append time

- GIVEN an event is being appended
- WHEN the append operation runs
- THEN `world_clock_at` is set from `WorldClock.now()` at that moment
- AND that value is stored as part of the immutable event

#### Scenario: Replay uses stored world clock value

- GIVEN historical events are being replayed to rebuild a projection
- WHEN each event is processed
- THEN the event's stored `world_clock_at` is used
- AND no recomputation against the current monotonic clock occurs

### Requirement: Tick Events

The system MUST emit `WorldTickAdvanced` events at integer-second boundaries of the world clock. A background tick loop MUST detect when integer boundaries are crossed and emit one tick event per crossed boundary.

The tick loop MUST be idempotent: if it wakes up after multiple boundaries have been crossed, it MUST emit one event per boundary in order, without duplicates and without skips.

#### Scenario: Tick event emitted at integer boundary

- GIVEN the world clock has just crossed an integer second (e.g., from 42.998 to 43.001)
- WHEN the tick loop next runs
- THEN a `WorldTickAdvanced` event with `tick_number: 43` is appended

#### Scenario: Tick loop catches up after delay

- GIVEN the tick loop was delayed and the world clock has advanced past multiple integer boundaries
- WHEN the tick loop runs
- THEN one `WorldTickAdvanced` event is appended for each crossed boundary, in order
- AND no boundary is skipped or duplicated