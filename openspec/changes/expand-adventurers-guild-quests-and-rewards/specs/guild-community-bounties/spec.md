# Spec Delta

## Purpose

Enables cooperative server-wide Community Bounty campaigns managed by admins/editors, aggregating qualifying Guild member actions toward shared milestones (25%, 50%, 100%, 150%) with anti-spam contribution accounting and eligible contributor reward claims.

## ADDED Requirements

### Requirement: Admin CRUD and lifecycle for Community Bounties
`ADMIN` and `EDITOR` users SHALL manage Community Bounties via `/v1/guild/admin/bounties` (list, get, create, update, publish, archive) with unique `slug`, `en`/`pt-BR` translations, `objectiveType`, validated `criteria`, `targetTotal`, `minUserContribution`, `maxUserContributionCap`, `[startsAt, endsAt)`, and rewards for `25%`, `50%`, `100%`, and `150%` milestones. Rules SHALL lock (`409 guild_bounty_rules_locked`) once any contribution exists.

#### Scenario: Editor publishes a seasonal Community Bounty
- **WHEN** an editor creates and publishes `"spooky-october-2026"` (`finish_game`, horror theme, `targetTotal: 500`)
- **THEN** the bounty becomes visible to Guild members on `GET /v1/guild/bounties`

### Requirement: Cooperative contribution tracking with per-user cap
Community Bounties SHALL NOT occupy a personal contract slot. When a Guild member commits a qualifying action during an active `published` bounty window, asynchronous evaluation SHALL deduplicate contributions by `(bountyId, profileUserId, sourceKey)` and increment `currentTotal` atomically up to `maxUserContributionCap` units per user.

#### Scenario: Multiple players contribute without consuming contract slots
- **WHEN** User A (holding max personal contracts) and User B each finish a qualifying horror game during `"spooky-october-2026"`
- **THEN** each user's contribution becomes `1` and `currentTotal` increases by `2`

#### Scenario: Single user cannot exceed maxUserContributionCap
- **WHEN** a bounty sets `maxUserContributionCap: 10` and one user submits 15 qualifying reviews
- **THEN** at most 10 units count toward `currentTotal`

### Requirement: Community Bounty milestone reads and contributor claims
`GET /v1/guild/bounties` SHALL list active bounties and bounties ended within the last 14 days with progress, milestone flags (`25`, `50`, `100`, `150`), `userContribution`, and claim state. `POST /v1/guild/bounties/:id/claim` SHALL atomically grant all unlocked, unclaimed milestones for contributors meeting `minUserContribution` (`403 guild_bounty_not_eligible` otherwise; `409 guild_bounty_nothing_to_claim` when nothing is claimable).

#### Scenario: Eligible contributor claims unlocked milestones atomically
- **WHEN** `"spooky-october-2026"` reaches `100%` and User A (`userContribution = 2`) calls `POST /v1/guild/bounties/:id/claim`
- **THEN** milestones 25%, 50%, and 100% are claimed once, rewards and Seals are credited, and a repeat call fails with 409 (`guild_bounty_nothing_to_claim`)

#### Scenario: Non-contributor is blocked from claiming
- **WHEN** User C (`userContribution = 0`) calls `POST /v1/guild/bounties/:id/claim`
- **THEN** the request fails with 403 (`guild_bounty_not_eligible`)
