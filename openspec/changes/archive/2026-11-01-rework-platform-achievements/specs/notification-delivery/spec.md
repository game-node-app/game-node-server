# Spec Delta

## ADDED Requirements

### Requirement: Achievement unlock notifications
Live achievement grants SHALL append an `achievement.unlocked` intent in the same transaction as the grant, addressed to the receiving user with no actor. One evaluation or manual grant SHALL produce at most one intent per definition, for its highest newly obtained tier. Backfill and migration grants SHALL NOT produce intents.

#### Scenario: Grant and intent commit together
- **WHEN** a review creation causes a user to obtain a tier
- **THEN** the obtained tier and its notification intent are committed atomically
- **AND** a rolled-back grant leaves no deliverable notification

#### Scenario: Several tiers in one evaluation
- **WHEN** one evaluation grants tiers 1 and 2 of the same definition
- **THEN** exactly one notification is produced, referencing tier 2

#### Scenario: Retroactive grant
- **WHEN** a backfill grants a tier to a user
- **THEN** no notification intent is created for that grant
