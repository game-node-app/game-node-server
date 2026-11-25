# Spec Delta

## Purpose

Provides rank-unlocked Monthly Expeditions (automatic Rank A and S long-form quests refreshed monthly) and the Monthly Guild Passport stamp track rewarding healthy monthly consistency at 2, 4, and 6 completed contracts.

## ADDED Requirements

### Requirement: Monthly Expedition board slot unlocked at Rank C
Starting at Guild Rank `C`, each member's board SHALL persist a 4th automatic slot (`slotIndex = 3`, `cycle = "monthly"`, keyed by São Paulo `monthKey = YYYY-MM`, acceptable until next month's 1st at 00:00 São Paulo). Ranks `C`–`B` SHALL roll Rank `A` templates (`30–45d`, `chest_gold`); Ranks `A`–`S` SHALL also include Rank `S` templates (`60d`, `chest_relic`). Ranks `E`–`D` SHALL see `monthlyExpeditionLocked: true`.

#### Scenario: Rank C user receives a persisted Rank A Monthly Expedition
- **WHEN** a Rank `C` user with a 45-hour unfinished RPG opens `GET /v1/guild/board` in November
- **THEN** the board includes a persisted Monthly Expedition (`slotIndex: 3`, `cycle: "monthly"`, `rank: "A"`) that stays stable all month

#### Scenario: Rank D user sees Monthly Expedition locked
- **WHEN** a Rank `D` user calls `GET /v1/guild/board`
- **THEN** no Monthly Expedition entry is generated and `monthlyExpeditionLocked` is `true`

#### Scenario: Rank A user includes Rank S templates in Monthly Expedition pool
- **WHEN** a Rank `A` user with synced game achievements generates their Monthly Expedition
- **THEN** Rank `S` templates (`platinum_crown`, `colossus_legend`, `saga_trilogy`) are eligible in the deterministic pool

### Requirement: Monthly Guild Passport stamp tracking
The system SHALL track each member's completed contracts per `America/Sao_Paulo` calendar month in `guild_passport_month`. Claiming any Guild contract SHALL atomically increment `completedContractsCount` for the São Paulo month of `claimedAt`. `GET /v1/guild/passport` SHALL return the current month's stamp count, milestone statuses (`locked`, `claimable`, `claimed`) for 2, 4, and 6 stamps, and `resetsAt`.

#### Scenario: Completing 2 contracts makes Passport milestone 2 claimable
- **WHEN** a user claims their 2nd Guild contract in November (São Paulo time) and calls `GET /v1/guild/passport`
- **THEN** `completedContractsCount` is `2`, milestone `2` is `"claimable"`, and milestones `4` and `6` are `"locked"`

### Requirement: Monthly Guild Passport milestone claims
`POST /v1/guild/passport/claim/:milestone` (`2`, `4`, or `6`) SHALL atomically verify `completedContractsCount >= milestone` (`409 guild_passport_milestone_not_reached`) and prevent double claims (`409 guild_passport_milestone_already_claimed`). Claiming SHALL grant: milestone `2` → `chest_bronze` + 25 Seals; milestone `4` → `chest_silver` + 50 Seals; milestone `6` → `chest_gold` + 100 Seals + 1 `hourglass`.

#### Scenario: Claiming Passport milestone 6 grants Gold Chest, Seals, and Hourglass once
- **WHEN** a user with 6 November stamps calls `POST /v1/guild/passport/claim/6`
- **THEN** `chest_gold` opens atomically, 100 Seals and 1 `hourglass` are granted, and a second call fails with 409 (`guild_passport_milestone_already_claimed`)
