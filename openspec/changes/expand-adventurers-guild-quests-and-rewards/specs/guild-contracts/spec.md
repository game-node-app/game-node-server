# Spec Delta

## Purpose

Expands contract evaluation across ten objective types with explicit anti-spam rules, rank-scaled active contract limits, optional secondary bonus objectives, and Hourglass deadline extensions.

## ADDED Requirements

### Requirement: Playtime contract evaluation (`log_playtime`)
The contract evaluator SHALL evaluate `log_playtime` from positive incremental deltas in `user_playtime_history` inside `[acceptedAt, min(expiresAt, now)]`, counting total minutes played or distinct qualifying games with at least `minPlaytimeSecondsPerGame` delta seconds. Initial lifetime import observations without a prior baseline SHALL contribute zero progress.

#### Scenario: Backlog taste test tracks distinct games played for 45+ minutes
- **WHEN** a user accepts `backlog_taste_test` (`targetCount: 2`, `minPlaytimeSecondsPerGame: 2700`) and logs 50 minutes on Game A and 30 minutes on Game B after `acceptedAt`
- **THEN** progress is `1 / 2`, and logging 20 more minutes on Game B transitions the contract to `ready_to_claim`

#### Scenario: Initial Steam import does not auto-complete a playtime contract
- **WHEN** a user accepts a 4-hour `log_playtime` contract and imports 120 hours of historical lifetime playtime with no prior baseline
- **THEN** progress remains `0`

### Requirement: Distinct active play-day evaluation (`play_distinct_days`)
The contract evaluator SHALL evaluate `play_distinct_days` by counting distinct `America/Sao_Paulo` calendar dates inside `[acceptedAt, min(expiresAt, now)]` on which the user logged at least 15 minutes (900 seconds) of positive incremental playtime delta across qualifying games.

#### Scenario: Days below 15 minutes do not count
- **WHEN** a user with `play_distinct_days` (`targetCount: 4`) logs 20 minutes on Monday, 10 minutes on Tuesday, and 30 minutes on Wednesday
- **THEN** the contract reports `progressCurrent: 2`

### Requirement: Daily challenge contract evaluation (`daily_challenge`)
Committed Daily puzzle wins SHALL enqueue asynchronous Guild evaluation (`trigger: "daily"`). `daily_challenge` contracts SHALL count distinct `daily_result` rows with `status = 'won'` and `finishedAt` inside the contract window, enforcing `requireNoDailyHint` (`hintAt IS NULL`) and `maxDailyAttempts` when configured. Practice rounds SHALL NOT count.

#### Scenario: No-hint Daily quest ignores hinted wins and practice rounds
- **WHEN** a user holds a `daily_challenge` contract (`targetCount: 2`, `requireNoDailyHint: true`) and logs one hinted win, one practice win, and two unhinted wins after `acceptedAt`
- **THEN** only the two unhinted wins count and the contract moves to `ready_to_claim`

### Requirement: Synced achievement and 100% completion evaluation (`earn_game_achievements`, `complete_game_100`)
Committed synced achievement imports SHALL enqueue Guild evaluation (`trigger: "game_achievement"`). `earn_game_achievements` SHALL count distinct achievements whose `obtainedAt` and `createdAt` both fall inside the contract window. `complete_game_100` SHALL count distinct games reaching `isCompleted` or `isPlatinumObtained` with `completedAt` inside the window and at least 5 available achievements.

#### Scenario: Historical achievement backfill does not count
- **WHEN** a user accepts `earn_game_achievements` (`targetCount: 10`) and syncs 50 achievements from 2022 alongside 6 earned after `acceptedAt`
- **THEN** the contract reports `progressCurrent: 6`

#### Scenario: Reaching platinum/100% on a qualifying game completes complete_game_100
- **WHEN** a user reaches `isCompleted: true` on a game with 30 available achievements and `completedAt >= acceptedAt`
- **THEN** their active `complete_game_100` contract transitions to `ready_to_claim`

### Requirement: Collection curation and post evaluation (`curate_collection`, `publish_post`)
Committed collection and post writes SHALL enqueue Guild evaluation (`trigger: "collection"` and `"post"`). `curate_collection` SHALL count public collections updated in the window with ≥ 20-char descriptions and ≥ `minCollectionEntries` (default 5) games, excluding collections credited in the last 30 days. `publish_post` SHALL count distinct games with non-deleted posts in the window having ≥ `minPostChars` (default 80) HTML-stripped characters.

#### Scenario: Post length check strips HTML tags
- **WHEN** a user publishes `<p>Great game</p>` while holding a `publish_post` contract requiring 80 plain-text characters
- **THEN** the post contributes 0 progress

#### Scenario: Same collection cannot be farmed twice within 30 days
- **WHEN** a user completes `curate_collection` with Collection X and edits Collection X again 5 days later under a new `curate_collection` contract
- **THEN** Collection X contributes 0 progress to the second contract

### Requirement: Backlog triage evaluation (`triage_backlog`)
`triage_backlog` SHALL count distinct games manually moved from `planned` to `playing`, `finished`, or `dropped` in `collection_entry_status_history` inside the contract window, only when the game had already been in `planned` status for at least 30 days prior to `acceptedAt`.

#### Scenario: Newly added and immediately dropped game does not count
- **WHEN** a user accepts `triage_backlog` (`targetCount: 3`), adds a new game as `planned`, and drops it immediately
- **THEN** that game contributes 0 progress

### Requirement: Extended game criteria validation and evaluation
Game-scoped objectives SHALL validate and evaluate extended `GuildCriteria` filters: `minTimeToBeatHours`, `releaseYearMin`, `releaseYearMax`, `franchiseIds`, `platformIds`, `gameCategories`, `indieOnly`, and `minReviewChars`. Accept-time `targetGameId` validation SHALL reject non-matching games with 400.

#### Scenario: Deep review quest enforces higher character floor
- **WHEN** a user accepts `deep_critic` (`criteria: { minReviewChars: 200 }`) and writes a 110-character review
- **THEN** the contract stays at `progressCurrent: 0`

#### Scenario: Epic colossus rejects short target games on accept
- **WHEN** a user tries to accept `the_colossus` (`minTimeToBeatHours: 35`) targeting a 10-hour game
- **THEN** `POST /v1/guild/contracts` responds with 400

### Requirement: Rank-scaled active contract cap and Extra Slot Permit
A user's maximum concurrent non-terminal contracts (`active` + `ready_to_claim`) SHALL be `3` for Ranks `E`–`C`, `4` for Ranks `B`–`S`, plus `+1` while an `extra_slot_permit` is active for the current São Paulo week (max 5). Accepting past the cap SHALL fail with 409 (`code: "guild_active_contract_limit_reached"`). Community Bounties SHALL NOT consume a personal slot.

#### Scenario: Rank B user holds 4 concurrent contracts
- **WHEN** a Rank `B` user with 3 `active` contracts accepts a 4th quest
- **THEN** the accept succeeds with 201 and a 5th accept fails with 409 (`code: "guild_active_contract_limit_reached"`)

#### Scenario: Extra Slot Permit grants a temporary 5th slot for the week
- **WHEN** a Rank `B` user activates `extra_slot_permit` and accepts a 5th quest during the same São Paulo week
- **THEN** the 5th accept succeeds until the next Monday rollover

### Requirement: Optional secondary Bonus Objectives on contracts
A quest MAY define an optional `bonusObjective` (`also_write_review`, `finish_before_half_deadline`, or `use_stale_backlog_game`) awarding extra XP, extra Seals, and/or a one-tier chest upgrade on claim. Failing the bonus objective SHALL NEVER block base completion or claim. When satisfied by claim time, `claimPayload.bonusCompleted` SHALL be `true`.

#### Scenario: Bonus objective upgrades chest tier and grants extra Seals on claim
- **WHEN** a user finishes `short_caravan` before half its deadline elapses while carrying `finish_before_half_deadline` with `upgradeChestTier: true` and `bonusSeals: 15`
- **THEN** claiming opens `chest_silver` instead of `chest_bronze`, credits +15 extra Seals, and sets `claimPayload.bonusCompleted = true`

#### Scenario: Missing bonus objective still allows base claim
- **WHEN** a user finishes the base objective on day 6 of a 7-day contract with `finish_before_half_deadline`
- **THEN** the contract claims normally with base rewards and `claimPayload.bonusCompleted = false`

### Requirement: Extending an active contract deadline with an Hourglass
`POST /v1/guild/contracts/:id/extend` SHALL consume 1 free monthly Rank `A`/`S` Hourglass allowance (when unused for the current São Paulo month) or 1 `hourglass` consumable to add 7 days to an owned `active` contract's `expiresAt` and reset `expiringNotifiedAt` to `null`. Each contract MAY be extended at most once (`409 guild_contract_already_extended`), and event contracts MAY NOT exceed `event.endsAt + 7 days`.

#### Scenario: Extending an active contract adds 7 days
- **WHEN** a user owning 1 `hourglass` calls `POST /v1/guild/contracts/:id/extend` on an unextended `active` contract
- **THEN** `expiresAt` increases by 7 days, `extendedCount` becomes 1, and `hourglass` inventory decrements by 1

#### Scenario: Second extension on the same contract is rejected
- **WHEN** the user calls `POST /v1/guild/contracts/:id/extend` a second time on that contract
- **THEN** the request fails with 409 (`code: "guild_contract_already_extended"`) without consuming an Hourglass
