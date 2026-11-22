# Spec Delta

## Purpose

Generates and serves each user's Monday-refreshed personalized Guild quest board across library, curated event, weekly, and GameNode-usage categories, enriched with locally cached game time-to-beat data and quick-quest filtering.

## ADDED Requirements

### Requirement: Weekly board cycle anchored to Monday São Paulo
The quest board SHALL run on weekly cycles starting Monday 00:00 `America/Sao_Paulo` (`weekStart` as `YYYY-MM-DD`) and ending the following Monday 00:00 `America/Sao_Paulo` (`nextRefreshAt` in ISO-8601 UTC). A user's generated non-event board entries for a `weekStart` SHALL be persisted on first access for that week and remain stable across reloads until the next Monday refresh.

#### Scenario: Repeated reads in the same week return the same board
- **WHEN** a user calls `GET /v1/guild/board` twice on Wednesday of the same São Paulo week without accepting any quests
- **THEN** both responses return the same persisted non-event quests and `weekStart`

#### Scenario: New Monday cycle generates a fresh board
- **WHEN** a user calls `GET /v1/guild/board` after Monday 00:00 `America/Sao_Paulo` of the following week
- **THEN** `weekStart` advances by 7 days, `nextRefreshAt` points to the next Monday 00:00 `America/Sao_Paulo`, and a new set of weekly board entries is generated

### Requirement: Personalized multi-category board composition
`GET /v1/guild/board` SHALL return open quests across four categories: `library` (personalized from backlog/playing entries with up to 3 candidate game chips), `event` (all active `published` curated events), `weekly` (rotating gameplay quests such as `< 8h` short games), and `gamenode` (review/app usage quests). When a user has no games qualifying for a personalized `library` template, the board SHALL fall back to eligible `weekly` or `gamenode` templates.

#### Scenario: User with stale backlog receives library quest with chips
- **WHEN** a user owns `Hollow Knight` in `planned` status since 2023 with no recent playtime and calls `GET /v1/guild/board`
- **THEN** the board includes the `library` stale-backlog quest with `Hollow Knight` among its `candidateGames` and `meta.sinceYear = 2023`

#### Scenario: User with an empty library still gets a playable board
- **WHEN** a newly registered user with zero library entries calls `GET /v1/guild/board`
- **THEN** the board omits library-only stale-backlog quests and still returns valid `weekly`, `gamenode`, and any active `event` quests

#### Scenario: Active curated event appears on every user's board
- **WHEN** an editor has published a curated event whose `[startsAt, endsAt)` window contains now
- **THEN** `GET /v1/guild/board` includes that event under category `event` with its `title`, `description`, `translations`, `rank`, `xpReward`, `reward`, and `expiresAt`

### Requirement: Board quest deadline and reward metadata
Board quests SHALL expose `contractDurationDays` (the deadline an accepted contract receives; `null` for events). Newly generated board entries SHALL link only active rewards.

#### Scenario: Library quest advertises a 21-day contract
- **WHEN** a user reads a board containing a `forgotten_relic` quest
- **THEN** that quest reports `contractDurationDays: 21`

### Requirement: Weekly board variety
Template choice per slot and candidate game chips SHALL rotate across weeks using a deterministic per-user weekly seed, so the same week stays stable while consecutive weeks can differ. The system template catalog SHALL include `double_feature` (finish 2 games, `weekly`) and `quick_take` (write 1 review, `gamenode`, quick) in addition to the original templates. Candidate chips SHALL be drawn from a wider eligible pool rather than always the same oldest or newest games.

#### Scenario: Large backlog shows different relic candidates over weeks
- **WHEN** a user with 20 eligible stale backlog games opens the board in two consecutive weeks
- **THEN** each week shows up to 3 candidates from that pool, chosen deterministically per week, and the two weeks are not required to show the same 3 games

#### Scenario: Same week stays stable
- **WHEN** a user reloads the board several times within one week
- **THEN** templates and candidate chips are identical across the reloads

### Requirement: Lina's recommended quest marker
At most one open quest on the user's current board SHALL be flagged `isRecommended: true`. Recommendation selection SHALL prioritize an open `library` stale-backlog quest first, then an active `event` quest, then the first open `weekly` quest.

#### Scenario: Stale backlog quest is recommended when available
- **WHEN** the user's open board contains both a `library` stale-backlog quest and an active `event`
- **THEN** the `library` quest has `isRecommended: true` and all other quests have `isRecommended: false`

### Requirement: Quick-quest filtering for Lina's fast-quest dialogue option
`GET /v1/guild/board` SHALL accept an optional boolean query parameter `quick`. When `quick=true`, the response SHALL include only open quests flagged `isQuick: true` (difficulty rank `D` or `E`, short-duration weekly quests, or quick platform-usage quests), ordered from lowest difficulty rank to highest.

#### Scenario: Requesting quicker quests filters the board
- **WHEN** a user requests `GET /v1/guild/board?quick=true`
- **THEN** only quests with `isQuick: true` are returned, ordered easiest first
- **AND** Rank `A` or `B` long-form quests are excluded

### Requirement: Local game time-to-beat caching with graceful degradation
Duration-based quest generation and candidate chip enrichment SHALL read game durations from a local `game_time_to_beat` cache populated lazily in batches from IGDB `game_time_to_beats`, negatively caching games without external data. External provider failures or rate limits SHALL NOT fail board or contract reads; generation SHALL degrade to cached data or a non-TTB fallback weekly template.

#### Scenario: Short games are cached and surfaced on short-duration quests
- **WHEN** a user's backlog contains games whose cached `normallySeconds` (or `hastilySeconds` fallback) is at most 8 hours
- **THEN** the short-duration weekly quest includes up to 3 of those games in `candidateGames` with rounded `estimatedHours`

#### Scenario: External time-to-beat outage does not break board reads
- **WHEN** the upstream IGDB time-to-beat endpoint fails while generating a board for uncached backlog games
- **THEN** `GET /v1/guild/board` still responds with 200 using available cached data or a non-TTB fallback weekly quest

### Requirement: Open board excludes accepted and completed quests
Quests for which the user already holds an `active`, `ready_to_claim`, or `completed` contract in the current week (or for the same curated event) SHALL NOT appear as open items in `GET /v1/guild/board`. Abandoned quests whose week or event window is still active SHALL remain visible and re-acceptable.

#### Scenario: Accepted quest leaves the open board
- **WHEN** a user accepts a quest from the current week's board and re-fetches `GET /v1/guild/board`
- **THEN** that quest is no longer listed on the open board and `boardCount` decreases by 1

#### Scenario: Abandoned quest returns to the open board
- **WHEN** a user abandons an `active` contract for a current-week quest and re-fetches `GET /v1/guild/board`
- **THEN** the quest appears on the open board again while the cycle is still active
