# Spec Delta

## Purpose

Manages each user's Adventurers Guild membership, sequential license number, Guild XP and Rank ladder (`E` through `S`), License statistics, current yearly goal summary, and Lina's contextual reception state with unseen-board tracking.

## ADDED Requirements

### Requirement: Supporter early-access rollout gate
`GUILD_ACCESS_MODE` (`"supporters"` or `"public"`, default `"public"`) SHALL gate player `/v1/guild/**` endpoints except `GET /v1/guild/access`. Under `"supporters"`, only active supporters, `ADMIN`, and `EDITOR` users SHALL be allowed; other authenticated users SHALL receive 403 (`code: "guild_early_access_required"`) without creating a `guild_profile`. Lapsed supporters SHALL keep existing Guild data and public profile cosmetics.

#### Scenario: Free user blocked during supporter early access
- **WHEN** `GUILD_ACCESS_MODE` is `"supporters"` and an authenticated non-supporter regular user calls `GET /v1/guild`
- **THEN** the system responds with 403 and `code: "guild_early_access_required"`
- **AND** no `guild_profile` row or `licenseNumber` is created for that user

#### Scenario: Supporter or editor allowed during early access
- **WHEN** `GUILD_ACCESS_MODE` is `"supporters"` and an active supporter or an `ADMIN`/`EDITOR` calls `GET /v1/guild`
- **THEN** access is granted normally

#### Scenario: Public mode opens access without billing checks
- **WHEN** `GUILD_ACCESS_MODE` is `"public"` and any authenticated user calls `GET /v1/guild`
- **THEN** access is granted regardless of supporter status

#### Scenario: Lapsed supporter preserves progress during early access
- **WHEN** a supporter with Guild XP, contracts, and equipped cosmetics loses supporter entitlement while `GUILD_ACCESS_MODE` is `"supporters"`
- **THEN** player `/v1/guild/**` calls return 403 (`code: "guild_early_access_required"`)
- **AND** their Guild profile, contracts, and public `guildTitleKey`/`guildFrameKey` remain preserved

### Requirement: Guild access discovery endpoint
`GET /v1/guild/access` SHALL be publicly accessible (`@Public()`) and return `{ mode, hasAccess }` without initializing a `guild_profile`, where `mode` is `"supporters"` or `"public"` and `hasAccess` is `true` only when the caller is authenticated and permitted by the current mode.

#### Scenario: Guest inspects Guild access during early access
- **WHEN** an unauthenticated visitor calls `GET /v1/guild/access` while `GUILD_ACCESS_MODE` is `"supporters"`
- **THEN** the response is 200 with `{ mode: "supporters", hasAccess: false }`

#### Scenario: Authenticated free user inspects Guild access across mode flip
- **WHEN** a signed-in non-supporter calls `GET /v1/guild/access` under `"supporters"` and later under `"public"`
- **THEN** the endpoint returns `{ mode: "supporters", hasAccess: false }` and then `{ mode: "public", hasAccess: true }`

### Requirement: Lazy authenticated Guild membership initialization
Accessing any authenticated Guild endpoint SHALL lazily initialize the user's Guild profile if missing, assigning a unique sequential `licenseNumber`, `xp = 0`, `rank = "E"`, and exposing `memberSince` from the user's profile creation date. Concurrent first requests SHALL create at most one Guild profile. Unauthenticated requests SHALL fail with 401.

#### Scenario: First visit initializes Guild License
- **WHEN** an authenticated user with no Guild profile requests `GET /v1/guild`
- **THEN** the system creates one Guild profile with a sequential `licenseNumber`, `xp = 0`, and `rank = "E"`
- **AND** returns the initialized Guild License

#### Scenario: Concurrent first visits do not duplicate membership
- **WHEN** two requests from a new user reach `GET /v1/guild` concurrently
- **THEN** both succeed and return the same `licenseNumber`

#### Scenario: Guest request is rejected
- **WHEN** an unauthenticated client requests `GET /v1/guild`
- **THEN** the system responds with 401

### Requirement: Guild Rank ladder and XP thresholds
The system SHALL compute a user's Guild Rank from cumulative Guild XP across six ordered ranks: `E` (0), `D` (300), `C` (800), `B` (2,000), `A` (4,000), and `S` (7,500). Reads SHALL expose `rank`, `xp`, `currentRankMinXp`, `nextRank`, `nextRankXp`, and `xpToNextRank`. At rank `S`, `nextRank` and `nextRankXp` SHALL be `null` and `xpToNextRank` SHALL be `0`.

#### Scenario: Mid-rank progression calculation
- **WHEN** a user has 1,240 Guild XP
- **THEN** the License reports `rank: "C"`, `currentRankMinXp: 800`, `nextRank: "B"`, `nextRankXp: 2000`, and `xpToNextRank: 760`

#### Scenario: Maximum rank reached
- **WHEN** a user has 7,500 or more Guild XP
- **THEN** the License reports `rank: "S"`, `nextRank: null`, `nextRankXp: null`, and `xpToNextRank: 0`

### Requirement: Guild overview aggregates License stats, active contracts, and yearly goal
`GET /v1/guild` SHALL return the user's Guild License (rank progression, `licenseNumber`, `memberSince`, `equippedTitleKey`, `equippedFrameKey`, and `stats: { finishedGames, backlogGames, reviewsCount }`), non-terminal contracts (`active` and `ready_to_claim`), the current year's `YearGoal` (`{ year, target, finished }` or `null`), tab counts (`boardCount`, `acceptedCount`, `completedCount`), board cycle (`weekStart`, `nextRefreshAt`), and Lina's reception state.

#### Scenario: Overview includes License stats and yearly goal
- **WHEN** a user with 47 finished games, 23 planned backlog games, 12 reviews, and a 2026 goal of 12 games requests `GET /v1/guild`
- **THEN** the response reports `stats: { finishedGames: 47, backlogGames: 23, reviewsCount: 12 }` and `yearGoal: { year: 2026, target: 12, finished: <2026 finished count> }`

#### Scenario: User has no yearly goal configured
- **WHEN** a user without a `YearGoal` for the current year requests `GET /v1/guild`
- **THEN** `yearGoal` is `null` and all other overview sections return normally

### Requirement: Yearly goal follows the São Paulo calendar
The overview's current year for `yearGoal` SHALL follow the `America/Sao_Paulo` calendar.

#### Scenario: New Year's Eve evening still shows the current year
- **WHEN** a user requests `GET /v1/guild` on December 31 at 22:00 São Paulo time
- **THEN** `yearGoal.year` is that December's year

### Requirement: Lina stale backlog eligibility and visit writes
Lina's `stale_backlog_game` pick SHALL use the same eligibility as the board's stale backlog quest (`planned` or `dropped`, untouched > 1 year). Repeated visits within one hour MAY skip rewriting `lastVisitedAt`.

#### Scenario: Dropped relic is highlighted
- **WHEN** a user's only stale backlog game is `dropped` since 2023 and no higher-priority trigger applies
- **THEN** `lina.trigger` is `stale_backlog_game` for that game

### Requirement: Lina contextual reception and dialogue triggers
`GET /v1/guild` SHALL return `lina: { trigger, pose, context, hasUnseenBoard }` choosing `trigger` by priority: `contract_ready_to_claim` (`pose: "happy"`), `returning_after_inactivity` (30+ days without Guild visit or platform activity), `weekly_board_refreshed` (unseen Monday cycle), `stale_backlog_game` (backlog game untouched > 1 year), or `default` (all `"neutral"`). Each visit SHALL update `lastVisitedAt` after checking inactivity without marking the board seen.

#### Scenario: Ready-to-claim contract takes top priority
- **WHEN** a user has both an unseen Monday board and a `ready_to_claim` contract
- **THEN** `lina.trigger` is `contract_ready_to_claim` and `lina.pose` is `"happy"`
- **AND** `lina.context` identifies the ready contract and its target game if bound

#### Scenario: Stale backlog game highlighted when board is already seen
- **WHEN** a user has no ready contracts, is not returning from 30+ days of inactivity, has already seen this week's board, and owns a planned game untouched since 2023
- **THEN** `lina.trigger` is `stale_backlog_game` and `lina.context` identifies that game and `sinceYear: 2023`

#### Scenario: Returning user after 30+ days of inactivity
- **WHEN** a user whose last Guild visit and last recorded platform activity were 35 days ago requests `GET /v1/guild`
- **THEN** `lina.trigger` is `returning_after_inactivity` with `inactiveDays >= 30`
- **AND** a subsequent immediate request no longer triggers `returning_after_inactivity`

### Requirement: Unseen board indicator and acknowledgement
`lina.hasUnseenBoard` SHALL be `true` whenever `lastBoardSeenAt` is `null`, earlier than the current Monday `America/Sao_Paulo` cycle start, or earlier than the latest `publishedAt` of any active curated event. Calling `POST /v1/guild/board/seen` SHALL set `lastBoardSeenAt` to now and return `{ hasUnseenBoard: false, lastBoardSeenAt }`.

#### Scenario: New Monday cycle raises unseen indicator
- **WHEN** a user last acknowledged the board during the previous week and visits on Monday after 00:00 `America/Sao_Paulo`
- **THEN** `lina.hasUnseenBoard` is `true`

#### Scenario: Publishing a new curated event raises unseen indicator
- **WHEN** a user already acknowledged this week's board and an editor publishes a new active curated event afterward
- **THEN** `lina.hasUnseenBoard` becomes `true` until the user calls `POST /v1/guild/board/seen`

#### Scenario: Acknowledging clears unseen indicator
- **WHEN** the user calls `POST /v1/guild/board/seen`
- **THEN** subsequent `GET /v1/guild` responses report `hasUnseenBoard: false` until the next refresh or newly published event
