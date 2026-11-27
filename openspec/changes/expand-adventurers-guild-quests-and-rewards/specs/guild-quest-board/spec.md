# Spec Delta

## Purpose

Extends the Adventurers Guild quest board with a 31-template automatic catalog across Ranks E through S, procedural library-DNA quest generation, background time-to-beat prefetch, rank-scaled composition, and deterministic weekly slot rerolls.

## ADDED Requirements

### Requirement: Expanded automatic template catalog across all objective families
The weekly and monthly quest boards SHALL draw from an expanded system template catalog spanning Ranks `E` through `S` across all ten `GuildObjectiveType` values. Every template SHALL define its `rank`, `minRank`, rebalanced `xpReward`, `sealsReward`, `objectiveType`, `targetCount`, `criteria`, `contractDurationDays`, and `rewardKey`.

#### Scenario: Weekly board rotates beyond finish and review quests
- **WHEN** a user generates their weekly board across consecutive Monday cycles
- **THEN** the `weekly` and `gamenode` slots rotate across gameplay, playtime, Daily challenge, backlog triage, collection curation, post, and review templates

#### Scenario: Synced achievement templates require synced external data
- **WHEN** a user without synced external game achievements generates a weekly or monthly board
- **THEN** `earn_game_achievements` and `complete_game_100` templates are excluded from their candidate pool and replaced by eligible templates

### Requirement: Tiered backlog relics for new and veteran accounts
The `library` slot SHALL support three staleness tiers for `planned` or `dropped` entries without recent playtime or prior finishes: `recent_dust` (Rank `C`, ≥ 90 days), `forgotten_relic` (Rank `B`, ≥ 365 days), and `ancient_fossil` (Rank `A`, ≥ 1,095 days or oldest untouched game in libraries older than 2 years).

#### Scenario: Account younger than one year receives recent_dust
- **WHEN** a user whose account is 6 months old holds a `planned` game untouched for 120 days and calls `GET /v1/guild/board`
- **THEN** `recent_dust` is eligible on the `library` slot with that game in `candidateGames` and `meta.staleDays >= 90`

#### Scenario: Veteran account qualifies for forgotten_relic and ancient_fossil
- **WHEN** a user holds untouched `planned` games older than 3 years
- **THEN** `forgotten_relic` is eligible on the weekly board and `ancient_fossil` is eligible for Rank `A` monthly expeditions

### Requirement: Procedural personalized quests from library DNA
Board generation SHALL dynamically synthesize `criteria`, `candidateGames` (up to 3), and `meta` from the user's library and IGDB metadata for procedural templates (`off_the_map`, `continue_the_saga`, `time_machine`, `hidden_gem`, `return_to_the_world`, `the_colossus`, `genre_marathon`, `saga_trilogy`). Ineligible procedural templates SHALL be skipped without failing board generation.

#### Scenario: Franchise continuation surfaces Continue the Saga
- **WHEN** a user has finished a game in a franchise and has an unfinished game from the same franchise in `planned` or `playing`
- **THEN** `continue_the_saga` becomes eligible with `criteria.franchiseIds`, `meta.franchiseName`, and the unfinished sequel in `candidateGames`

#### Scenario: Genre inversion surfaces Off the Map
- **WHEN** a user's backlog contains unfinished games in a genre underrepresented among their finished games
- **THEN** `off_the_map` becomes eligible with `criteria.genreIds`, `meta.genreName`, and matching backlog games in `candidateGames`

#### Scenario: Missing long-TTB games skips The Colossus cleanly
- **WHEN** a user has no unfinished library games with cached TTB ≥ 35 hours
- **THEN** `the_colossus` is skipped and another eligible template fills the slot

### Requirement: Deterministic weekly board slot reroll
`POST /v1/guild/board/:entryId/reroll` SHALL replace an open weekly board entry (slots 0–2 of the current São Paulo week) with another eligible template using a deterministic seed incorporating `rerollCount`. It SHALL consume 1 free weekly reroll allowance (1/week at Rank `D`, 2/week at Rank `S`) or 1 `reroll_charter`, failing with 409 (`code: "guild_reroll_unavailable"`) when neither is available.

#### Scenario: Rank D user uses weekly free reroll on an open slot
- **WHEN** a Rank `D` user with 1 free reroll remaining calls `POST /v1/guild/board/:entryId/reroll` on an unaccepted `weekly` entry
- **THEN** the entry updates in place with a different eligible template, `rerollCount` increments, and remaining free rerolls becomes 0

#### Scenario: Reroll consumes reroll_charter when free rerolls are exhausted
- **WHEN** a user with 0 free rerolls remaining and 2 `reroll_charter` consumables calls `POST /v1/guild/board/:entryId/reroll`
- **THEN** 1 `reroll_charter` is deducted atomically, the slot rerolls deterministically, and the response reports `consumableUsed: "reroll_charter"`

#### Scenario: Accepted, monthly, or event quests cannot be rerolled
- **WHEN** a user calls `POST /v1/guild/board/:entryId/reroll` on an already accepted entry, a Monthly Expedition, or when no reroll allowance or charter exists
- **THEN** the request is rejected with 409 and the board remains unchanged

### Requirement: Background time-to-beat prefetch for active Guild members
A scheduled background sweep SHALL periodically warm missing or stale `game_time_to_beat` rows for `planned` and `playing` library games of recently active Guild members within a bounded per-tick batch respecting outbound IGDB budgets, never blocking board reads or failing on upstream outages.

#### Scenario: Prefetch warms TTB rows for larger backlogs
- **WHEN** the scheduled TTB prefetch runs for active Guild members with uncached backlog games
- **THEN** up to the bounded per-tick batch of missing/stale `game_time_to_beat` rows are fetched and upserted locally while gracefully skipping upstream errors

### Requirement: Extended board response metadata
`GET /v1/guild/board` SHALL include additive fields `rerollsRemaining`, `rerollChartersOwned`, `monthlyExpeditionLocked`, and per-quest `cycle`, `sealsReward`, `bonusObjective`, and procedural `meta` keys (`genreName`, `franchiseName`, `decade`, `staleDays`).

#### Scenario: Board response advertises rerolls and bonus objectives
- **WHEN** a Rank `D` user calls `GET /v1/guild/board`
- **THEN** the response includes `rerollsRemaining: 1`, `monthlyExpeditionLocked: true`, and each quest carries its `sealsReward` and optional `bonusObjective`
