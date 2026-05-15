## ADDED Requirements

### Requirement: UpgradeFarm command sequences events across Player and Site aggregates
The system SHALL provide `handleUpgradeFarm({ siteId, playerId })` that:
1. Reads the current Site projection and validates: farm exists, no upgrade in progress
2. Reads the current Player projection and validates: money >= upgrade cost (100 × current level)
3. Generates a shared `correlation_id` for this command
4. Appends `MoneySpent { amount, reason: "upgrade_farm" }` to the Player aggregate
5. Appends `FarmUpgradeStarted { from_level, to_level, started_at_world_clock, completes_at_world_clock }` to the Site aggregate, with `causation_id` referencing the `MoneySpent` event
6. If step 5 throws `ConcurrencyError`, appends `MoneyRefunded { amount, reason: "upgrade_farm_failed" }` to the Player aggregate referencing the failed `correlation_id`

Both `MoneySpent` and `FarmUpgradeStarted` (and `MoneyRefunded` if emitted) SHALL share the same `correlation_id`.

#### Scenario: UpgradeFarm succeeds when both aggregates are valid
- **WHEN** `handleUpgradeFarm` is called, farm is at level 1, player has $100
- **THEN** `MoneySpent { amount: 100 }` is appended to Player and `FarmUpgradeStarted { from_level: 1, to_level: 2 }` is appended to Site, both with the same `correlation_id`

#### Scenario: UpgradeFarm rejected when player cannot afford
- **WHEN** `handleUpgradeFarm` is called and player money < upgrade cost
- **THEN** a validation error is thrown before any events are appended

#### Scenario: UpgradeFarm rejected when no farm exists
- **WHEN** `handleUpgradeFarm` is called and site has no built farm
- **THEN** a validation error is thrown before any events are appended

#### Scenario: UpgradeFarm rejected when upgrade already in progress
- **WHEN** `handleUpgradeFarm` is called and site has a `FarmUpgradeStarted` without a corresponding `FarmUpgradeCompleted`
- **THEN** a validation error is thrown before any events are appended

#### Scenario: Compensating MoneyRefunded appended on Site concurrency failure
- **WHEN** `MoneySpent` is successfully appended to Player, but appending `FarmUpgradeStarted` to Site throws `ConcurrencyError`
- **THEN** `MoneyRefunded { amount }` is appended to the Player aggregate, referencing the failed `correlation_id`
- **AND** the Site aggregate is left unchanged

### Requirement: Correlation and causation chain maintained across aggregates
In a successful `UpgradeFarm` command, the `causation_id` of `FarmUpgradeStarted` SHALL be the `event_id` of the `MoneySpent` event. The `causation_id` of `MoneySpent` SHALL be null (it is the first event in the chain). The `correlation_id` SHALL be the same UUID on both events.

#### Scenario: Causation chain is correct
- **WHEN** `UpgradeFarm` completes successfully
- **THEN** `MoneySpent.causation_id` is null and `FarmUpgradeStarted.causation_id` equals `MoneySpent.event_id`
- **AND** both events share the same `correlation_id`
