## ADDED Requirements

### Requirement: Player projection computes money balance
The system SHALL provide `buildPlayerProjection(events: EventEnvelope[]): PlayerState` where `events` is the filtered list of events for the Player aggregate. `PlayerState` SHALL expose `money` (non-negative integer) computed as the sum of `MoneyReceived.amount` events minus `MoneySpent.amount` events plus `MoneyRefunded.amount` events, folded in `aggregate_version` order.

#### Scenario: Balance after credits and debits
- **WHEN** the Player aggregate has `MoneyReceived(100)`, `MoneySpent(40)`, `MoneyReceived(20)` in version order
- **THEN** `buildPlayerProjection` returns `{ money: 80 }`

#### Scenario: Balance after compensation
- **WHEN** the Player aggregate has `MoneySpent(50)` followed by `MoneyRefunded(50)` with the same correlation_id
- **THEN** `buildPlayerProjection` returns `{ money: 0 }` (net zero effect)

#### Scenario: Empty aggregate starts at zero
- **WHEN** `buildPlayerProjection([])` is called
- **THEN** the result is `{ money: 0 }`

### Requirement: GiveMoney command appends MoneyReceived event
The system SHALL provide `handleGiveMoney({ playerId, amount })` that validates `amount > 0` and appends a `MoneyReceived` event to the Player aggregate with `source: "debug"`. The function SHALL read the current Player aggregate version to set `aggregate_version` correctly.

#### Scenario: GiveMoney credits the player
- **WHEN** `handleGiveMoney({ playerId: "p1", amount: 100 })` is called
- **THEN** a `MoneyReceived` event with `amount: 100` and `source: "debug"` is appended to the Player aggregate

#### Scenario: GiveMoney rejected for zero or negative amount
- **WHEN** `handleGiveMoney({ playerId: "p1", amount: 0 })` is called
- **THEN** a validation error is thrown and no event is appended

### Requirement: Player aggregate ID is a singleton for the prototype
For this prototype, the Player aggregate SHALL use a fixed ID `"player-1"`. All Player commands SHALL target this ID. This simplifies the prototype without requiring a player session layer.

#### Scenario: Player commands target fixed ID
- **WHEN** any Player command is issued
- **THEN** the resulting event has `aggregate_id: "player-1"`
