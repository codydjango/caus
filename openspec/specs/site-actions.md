# Site Actions

The player's commands for shaping the Site aggregate and supporting the Player aggregate. This slice covers three commands: building a farm on an empty site, upgrading an existing farm to the next level, and a debug command to credit money to the player. Farm production (recurring income) is out of scope here.

## Requirements

### Requirement: Build Farm Command

The player MUST be able to issue a `BuildFarm` command targeting an empty Site. The command MUST be validated and, on success, emit events that begin a build timer.

Build cost: free (this slice).
Build duration: 30 seconds of world clock.

#### Scenario: BuildFarm succeeds on empty site

- GIVEN a Site with no current building and no in-progress build
- WHEN the player issues a `BuildFarm` command
- THEN a `FarmBuildStarted` event is appended to the Site aggregate
- AND the event payload includes `started_at_world_clock` and `completes_at_world_clock` (started + 30 seconds)

#### Scenario: BuildFarm rejected on occupied site

- GIVEN a Site that already has a built farm
- WHEN the player issues a `BuildFarm` command
- THEN the command is rejected with a validation error
- AND no event is appended

#### Scenario: BuildFarm rejected during in-progress build

- GIVEN a Site with a `FarmBuildStarted` event but no `FarmBuildCompleted` event yet
- WHEN the player issues a `BuildFarm` command
- THEN the command is rejected with a validation error
- AND no event is appended

### Requirement: Farm Build Completion

When the world clock reaches a Site's `completes_at_world_clock` for an in-progress build, the system MUST emit a `FarmBuildCompleted` event automatically. The completion event is system-triggered, not player-triggered.

#### Scenario: Build completes at the scheduled world clock

- GIVEN a `FarmBuildStarted` event exists with `completes_at_world_clock: T`
- WHEN the world clock reaches or exceeds T
- THEN a `FarmBuildCompleted` event is appended to the Site aggregate
- AND the event's `causation_id` references the `FarmBuildStarted` event

#### Scenario: Build completion is idempotent

- GIVEN a `FarmBuildCompleted` event has already been appended for a given build
- WHEN the system re-evaluates whether to emit completion (e.g., after a restart)
- THEN no duplicate `FarmBuildCompleted` is appended

### Requirement: Upgrade Farm Command

The player MUST be able to issue an `UpgradeFarm` command targeting a Site with a completed farm. The command MUST be validated against both the Site state (farm exists and not currently upgrading) and the Player state (sufficient money). On success, money MUST be debited from the Player aggregate and an upgrade timer MUST begin on the Site aggregate.

Upgrade cost: $100 × current_level (level 1→2 costs $100, level 2→3 costs $200, etc.).
Upgrade duration: 120 seconds of world clock.

#### Scenario: UpgradeFarm succeeds when affordable

- GIVEN a Site with a built farm at level L and no in-progress upgrade
- AND a Player with money balance ≥ ($100 × L)
- WHEN the player issues an `UpgradeFarm` command
- THEN a `MoneySpent` event is appended to the Player aggregate (amount: $100 × L, reason: `upgrade_farm`)
- AND a `FarmUpgradeStarted` event is appended to the Site aggregate (with `from_level`, `to_level`, `started_at_world_clock`, `completes_at_world_clock`)
- AND both events share a correlation_id
- AND the `FarmUpgradeStarted` event's causation_id references the `MoneySpent` event

#### Scenario: UpgradeFarm rejected when unaffordable

- GIVEN a Player with money balance < the upgrade cost
- WHEN the player issues an `UpgradeFarm` command
- THEN the command is rejected with a validation error
- AND no events are appended

#### Scenario: UpgradeFarm rejected when no farm exists

- GIVEN a Site with no built farm
- WHEN the player issues an `UpgradeFarm` command
- THEN the command is rejected with a validation error
- AND no events are appended

#### Scenario: UpgradeFarm rejected during in-progress upgrade

- GIVEN a Site with a `FarmUpgradeStarted` event but no corresponding `FarmUpgradeCompleted` event
- WHEN the player issues an `UpgradeFarm` command
- THEN the command is rejected with a validation error
- AND no events are appended

#### Scenario: UpgradeFarm fails mid-sequence with compensation

- GIVEN a `MoneySpent` event has been appended to the Player aggregate
- WHEN appending `FarmUpgradeStarted` to the Site aggregate fails (e.g., concurrency conflict)
- THEN a compensating `MoneyRefunded` event is appended to the Player aggregate
- AND the refund event references the failed correlation_id

### Requirement: Farm Upgrade Completion

When the world clock reaches a Site's `completes_at_world_clock` for an in-progress upgrade, the system MUST emit a `FarmUpgradeCompleted` event automatically.

#### Scenario: Upgrade completes at the scheduled world clock

- GIVEN a `FarmUpgradeStarted` event exists with `completes_at_world_clock: T` and `to_level: L`
- WHEN the world clock reaches or exceeds T
- THEN a `FarmUpgradeCompleted` event is appended to the Site aggregate
- AND the event payload includes `new_level: L`
- AND the event's `causation_id` references the `FarmUpgradeStarted` event

#### Scenario: Upgrade completion is idempotent

- GIVEN a `FarmUpgradeCompleted` event has already been appended for a given upgrade
- WHEN the system re-evaluates whether to emit completion
- THEN no duplicate `FarmUpgradeCompleted` is appended

### Requirement: Site Projection Reflects Build and Upgrade State

The Site projection MUST reflect the current state of the farm derivable from the events in the Site aggregate's stream.

The projection MUST expose:
- `has_farm` — boolean, true after `FarmBuildCompleted`
- `level` — integer, 1 after build completion, incremented by each `FarmUpgradeCompleted`
- `build_in_progress` — `null` or `{ started_at, completes_at }`
- `upgrade_in_progress` — `null` or `{ from_level, to_level, started_at, completes_at }`

#### Scenario: Projection after BuildFarm but before completion

- GIVEN a Site with a `FarmBuildStarted` event and no `FarmBuildCompleted` event
- WHEN the Site projection is computed
- THEN `has_farm` is false
- AND `build_in_progress` reflects the build's timing

#### Scenario: Projection after FarmBuildCompleted

- GIVEN a Site with `FarmBuildStarted` followed by `FarmBuildCompleted`
- WHEN the Site projection is computed
- THEN `has_farm` is true
- AND `level` is 1
- AND `build_in_progress` is null

#### Scenario: Projection after multiple upgrades

- GIVEN a Site with one `FarmBuildCompleted` and N `FarmUpgradeCompleted` events
- WHEN the Site projection is computed
- THEN `level` is 1 + N

### Requirement: Give Money Command (Debug)

The system MUST provide a `GiveMoney` command that credits a specified amount of money to the Player aggregate. In this slice the command is a debug/cheat action used to bootstrap the prototype; the underlying `MoneyReceived` event is also intended to represent legitimate future income sources (farm production, quest rewards, trade settlements) and so MUST be modeled as a generic credit event, not a debug-specific event.

The command MUST accept any positive integer amount.

#### Scenario: GiveMoney credits the player

- GIVEN a Player with money balance B
- WHEN the player issues a `GiveMoney` command with amount A > 0
- THEN a `MoneyReceived` event is appended to the Player aggregate
- AND the event payload includes `amount: A` and `source: "debug"`
- AND the Player projection reflects a money balance of B + A

#### Scenario: GiveMoney rejected for non-positive amount

- GIVEN any Player state
- WHEN the player issues a `GiveMoney` command with amount ≤ 0
- THEN the command is rejected with a validation error
- AND no event is appended

### Requirement: Player Projection Reflects Money Balance

The Player projection MUST reflect the current money balance derivable from the events in the Player aggregate's stream. The balance is the sum of all `MoneyReceived` events minus the sum of all `MoneySpent` events plus the sum of all `MoneyRefunded` events.

The projection MUST expose:
- `money` — non-negative integer

#### Scenario: Projection after receiving and spending money

- GIVEN a Player with `MoneyReceived(100)`, `MoneySpent(40)`, and `MoneyReceived(20)` events in order
- WHEN the Player projection is computed
- THEN `money` is 80

#### Scenario: Projection after compensation

- GIVEN a Player with `MoneySpent(50)` followed by `MoneyRefunded(50)` referencing the same correlation_id
- WHEN the Player projection is computed
- THEN the net effect on `money` is zero