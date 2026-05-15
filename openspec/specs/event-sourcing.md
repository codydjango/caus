# Event Sourcing

The system's core persistence and state model. All state changes are captured as immutable events; current state is derived as a projection over the event log.

## Requirements

### Requirement: Append-Only Event Log

The system MUST maintain a single append-only event log as the source of truth for all state changes. Events MUST NOT be deleted or modified after being appended.

#### Scenario: Event is appended successfully

- GIVEN a valid command has been processed
- WHEN the resulting event is written to the log
- THEN the event is persisted with a monotonically increasing position
- AND the event becomes immediately readable to projection consumers

#### Scenario: Mutation of historical event is rejected

- GIVEN an event exists in the log
- WHEN any code attempts to modify or delete that event
- THEN the operation is rejected
- AND the log remains unchanged

### Requirement: Event Envelope

Every event MUST carry a standard envelope independent of its type-specific payload. The envelope provides identity, ordering, attribution, and metadata needed for projection and future temporal queries.

The envelope MUST include:

- `event_id` — globally unique identifier
- `event_type` — string identifying the kind of event (e.g., `FarmBuildStarted`)
- `aggregate_type` — the aggregate this event belongs to (e.g., `Player`, `Site`)
- `aggregate_id` — the specific aggregate instance
- `aggregate_version` — the expected version of the aggregate when this event was appended (for optimistic concurrency)
- `world_clock_at` — the world clock value at time of append (see World Clock spec)
- `wall_clock_at` — the wall-clock timestamp at time of append
- `correlation_id` — groups events resulting from a single command
- `causation_id` — references the immediate event (if any) that caused this one
- `scope_tags` — list of tags for future scoped queries (e.g., `["economy", "site:01"]`)
- `payload` — event-type-specific data

#### Scenario: Event is written with full envelope

- GIVEN a command is being processed
- WHEN an event is appended to the log
- THEN the envelope includes every required field
- AND envelope fields are populated before payload-specific data

#### Scenario: Correlated events share a correlation_id

- GIVEN a command that emits multiple events
- WHEN those events are appended
- THEN all events share the same correlation_id
- AND each event's causation_id references the immediately prior event in the chain (or is null for the first)

### Requirement: Aggregate Boundaries

The system MUST organize events by aggregate, where each aggregate is a consistency boundary that enforces its own invariants. The prototype defines two aggregates: `Player` and `Site`.

The `Player` aggregate owns:
- Money balance
- (Future: HP, CP, regen rate — out of scope for this slice)

The `Site` aggregate owns:
- Current building (none, in-progress, or built)
- Current building level
- In-progress build/upgrade timer state

#### Scenario: Player invariant enforced within Player aggregate

- GIVEN a command that affects Player state (e.g., spending money)
- WHEN the command is validated and emits events
- THEN the events target the Player aggregate
- AND invariants such as "money balance MUST NOT go negative" are enforced atomically within the aggregate

#### Scenario: Site invariant enforced within Site aggregate

- GIVEN a command that affects Site state (e.g., starting a build)
- WHEN the command is validated and emits events
- THEN the events target the Site aggregate
- AND invariants such as "Site MUST NOT have a building already" are enforced atomically within the aggregate

### Requirement: Optimistic Concurrency

The system MUST use `aggregate_version` to detect concurrent modifications. An event append MUST specify the expected current version of the target aggregate; if the actual version differs, the append MUST be rejected.

#### Scenario: Stale version is rejected

- GIVEN an aggregate is at version N
- WHEN an event append specifies expected version M ≠ N
- THEN the append is rejected with a concurrency error
- AND no event is written

### Requirement: Projections Are Derived

The system MUST derive all current state from the event log. Projections are functions of events; they MUST NOT be the source of truth.

#### Scenario: Projection rebuilt from events

- GIVEN an event log with N events for an aggregate
- WHEN the aggregate's projection is requested
- THEN the projection is computed by folding the events in order
- AND the result is deterministic given the same input events

#### Scenario: Projection reflects latest events

- GIVEN a new event is appended for an aggregate
- WHEN the projection is next requested
- THEN the projection reflects the new event

### Requirement: Cross-Aggregate Commands Are Sequenced

Commands that affect more than one aggregate (e.g., upgrade farm: debit Player money + advance Site upgrade) MUST be implemented as a sequence of single-aggregate events, not as multi-aggregate atomic transactions. Failures partway through MUST be handled by compensating events.

#### Scenario: Cross-aggregate command succeeds

- GIVEN a command that affects Player and Site
- WHEN preconditions on both aggregates are satisfied
- THEN events are appended to each aggregate in sequence
- AND all events share a correlation_id
- AND the causation_id chain links them in order

#### Scenario: Cross-aggregate command fails mid-sequence

- GIVEN a command has appended events to the first aggregate
- WHEN appending to the second aggregate fails (e.g., concurrency conflict)
- THEN a compensating event is appended to the first aggregate to reverse its effect
- AND the compensating event references the failed correlation_id