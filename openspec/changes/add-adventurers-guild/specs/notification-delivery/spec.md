# Spec Delta

## ADDED Requirements

### Requirement: Guild contract ready notifications
The system SHALL emit a system notification (`guild.contract-ready`, version 1) with no actor, committed atomically when an accepted Guild contract moves from `active` to `ready_to_claim`. It SHALL materialize as an individual inbox item with a safe preview and destination `{ type: "guild", contractId }`, producing at most one notification per contract under retries or concurrent evaluation.

#### Scenario: Fulfilled contract notifies recipient to return to Lina's counter
- **WHEN** a user finishes the target game for an active Guild contract and evaluation transitions the contract to `ready_to_claim`
- **THEN** a `guild.contract-ready` notification intent commits in the same transaction
- **AND** the recipient's inbox materializes one individual item with destination `{ type: "guild", contractId }`

#### Scenario: Duplicate evaluation produces no duplicate notification
- **WHEN** two evaluation jobs inspect the same newly fulfilled Guild contract concurrently
- **THEN** only one `guild.contract-ready` notification intent is persisted and delivered

### Requirement: Guild contract expiring notifications
The system SHALL emit a system notification (`guild.contract-expiring`, version 1) with no actor, at most once per contract, when an `active` Guild contract's deadline is within the next 24 hours. It SHALL materialize as an individual inbox item with a safe preview and destination `{ type: "guild", contractId }`. Contracts that are no longer `active` when the reminder is processed SHALL NOT be notified.

#### Scenario: Player is warned before a contract expires
- **WHEN** an `active` contract's `expiresAt` is 20 hours away during the periodic reminder run
- **THEN** one `guild.contract-expiring` notification intent is committed for its owner
- **AND** later reminder runs do not notify that contract again

#### Scenario: Completed contracts are not warned
- **WHEN** a contract reached `ready_to_claim` before entering its last 24 hours
- **THEN** no `guild.contract-expiring` notification is emitted for it
