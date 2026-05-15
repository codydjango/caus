## ADDED Requirements

### Requirement: Site projection exposes farm build and upgrade state
The system SHALL provide `buildSiteProjection(events: EventEnvelope[]): SiteState` where `events` is the filtered list of events for the Site aggregate. `SiteState` SHALL expose:
- `has_farm` — boolean, true after a `FarmBuildCompleted` event
- `level` — integer, 0 before build, 1 after `FarmBuildCompleted`, incremented by each `FarmUpgradeCompleted`
- `build_in_progress` — `null` or `{ started_at: bigint, completes_at: bigint }`
- `upgrade_in_progress` — `null` or `{ from_level: number, to_level: number, started_at: bigint, completes_at: bigint }`

#### Scenario: Projection after FarmBuildStarted only
- **WHEN** the Site aggregate has only a `FarmBuildStarted` event
- **THEN** `has_farm` is false, `build_in_progress` is non-null with correct timing fields

#### Scenario: Projection after FarmBuildCompleted
- **WHEN** the Site aggregate has `FarmBuildStarted` followed by `FarmBuildCompleted`
- **THEN** `has_farm` is true, `level` is 1, `build_in_progress` is null

#### Scenario: Projection after multiple upgrades
- **WHEN** the Site aggregate has one `FarmBuildCompleted` and two `FarmUpgradeCompleted` events
- **THEN** `level` is 3

### Requirement: BuildFarm command
The system SHALL provide `handleBuildFarm({ siteId })` that validates the site has no existing farm and no in-progress build, then appends `FarmBuildStarted` with `started_at_world_clock` (current `WorldClock.now()`) and `completes_at_world_clock` (`started_at + 30_000_000n` microseconds).

#### Scenario: BuildFarm succeeds on empty site
- **WHEN** `handleBuildFarm({ siteId: "site-1" })` is called and the site has no events
- **THEN** `FarmBuildStarted` is appended with correct `started_at_world_clock` and `completes_at_world_clock`

#### Scenario: BuildFarm rejected when farm exists
- **WHEN** the site has a `FarmBuildCompleted` event and `handleBuildFarm` is called
- **THEN** a validation error is thrown and no event is appended

#### Scenario: BuildFarm rejected during in-progress build
- **WHEN** the site has `FarmBuildStarted` but no `FarmBuildCompleted` and `handleBuildFarm` is called
- **THEN** a validation error is thrown and no event is appended

### Requirement: Tick loop fires FarmBuildCompleted when timer expires
The tick loop SHALL check, on each invocation, whether a `FarmBuildStarted` event exists without a corresponding `FarmBuildCompleted` event and whether `completes_at_world_clock <= WorldClock.now()`. If so, it SHALL append `FarmBuildCompleted` with `causation_id` referencing the `FarmBuildStarted` event.

#### Scenario: Build completion fires at or after completes_at
- **WHEN** the world clock reaches `completes_at_world_clock` for an in-progress build
- **THEN** `FarmBuildCompleted` is appended on the next tick loop invocation

#### Scenario: Build completion is idempotent
- **WHEN** `FarmBuildCompleted` has already been appended
- **THEN** the tick loop does not append a second `FarmBuildCompleted`

### Requirement: Tick loop fires FarmUpgradeCompleted when timer expires
Same pattern as build completion: the tick loop SHALL append `FarmUpgradeCompleted { new_level }` when `FarmUpgradeStarted` exists without `FarmUpgradeCompleted` and `completes_at_world_clock <= WorldClock.now()`.

#### Scenario: Upgrade completion fires at or after completes_at
- **WHEN** the world clock reaches `completes_at_world_clock` for an in-progress upgrade
- **THEN** `FarmUpgradeCompleted { new_level }` is appended on the next tick loop invocation

#### Scenario: Upgrade completion is idempotent
- **WHEN** `FarmUpgradeCompleted` has already been appended
- **THEN** the tick loop does not append a second `FarmUpgradeCompleted`

### Requirement: Site aggregate ID is a singleton for the prototype
For this prototype, the Site aggregate SHALL use a fixed ID `"site-1"`. All Site commands SHALL target this ID.

#### Scenario: Site commands target fixed ID
- **WHEN** any Site command is issued
- **THEN** the resulting event has `aggregate_id: "site-1"`
