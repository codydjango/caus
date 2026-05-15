## ADDED Requirements

### Requirement: SQLite events table with full envelope
The system SHALL store all events in a SQLite database at `data/events.db` in a table named `events`. The table SHALL have columns for every field in the event envelope defined in the `event-sourcing` spec: `event_id` (TEXT PRIMARY KEY), `event_type` (TEXT NOT NULL), `aggregate_type` (TEXT NOT NULL), `aggregate_id` (TEXT NOT NULL), `aggregate_version` (INTEGER NOT NULL), `world_clock_at` (INTEGER NOT NULL), `wall_clock_at` (INTEGER NOT NULL), `correlation_id` (TEXT), `causation_id` (TEXT), `scope_tags` (TEXT, JSON array), `payload` (TEXT, JSON object).

#### Scenario: Event appended with all envelope fields populated
- **WHEN** a command handler appends a new event
- **THEN** the row contains non-null values for `event_id`, `event_type`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `world_clock_at`, `wall_clock_at`, and `payload`

#### Scenario: Database file created on first run
- **WHEN** the application starts and `data/events.db` does not exist
- **THEN** the database file and `events` table are created automatically before any event is appended

### Requirement: Append-only enforcement at the application layer
The system SHALL provide `appendEvent(event)` as the sole write path. There SHALL be no `updateEvent` or `deleteEvent` function exported. TypeScript module exports SHALL make mutation impossible without bypassing the module.

#### Scenario: No mutation function exported
- **WHEN** a consumer imports from `src/db/store.ts`
- **THEN** only `appendEvent`, `readEvents`, and `readEventsByAggregate` are available; no update or delete function exists

### Requirement: Optimistic concurrency check on append
The system SHALL reject an `appendEvent` call if `event.aggregate_version` does not equal `(current max version for that aggregate) + 1`. For the first event on an aggregate the expected version is 1. On conflict the function SHALL throw a `ConcurrencyError`.

#### Scenario: Version matches — append succeeds
- **WHEN** a Site aggregate has 2 events (versions 1 and 2) and `appendEvent` is called with `aggregate_version: 3`
- **THEN** the event is inserted successfully

#### Scenario: Stale version — append rejected
- **WHEN** a Site aggregate has 2 events and `appendEvent` is called with `aggregate_version: 2`
- **THEN** a `ConcurrencyError` is thrown and no row is inserted

### Requirement: Aggregate-scoped event reads
The system SHALL provide `readEventsByAggregate(aggregateType, aggregateId)` that returns all events for a specific aggregate in ascending `aggregate_version` order.

#### Scenario: Returns only events for the requested aggregate
- **WHEN** the event log contains events for Player aggregate "p1" and Site aggregate "s1"
- **THEN** `readEventsByAggregate("Site", "s1")` returns only the Site events in version order

### Requirement: Full event log read
The system SHALL provide `readEvents()` that returns all events in ascending `world_clock_at` order, with ties broken by `aggregate_version`.

#### Scenario: Events ordered by world clock
- **WHEN** events from multiple aggregates are in the log
- **THEN** `readEvents()` returns them all in `world_clock_at` ascending order
