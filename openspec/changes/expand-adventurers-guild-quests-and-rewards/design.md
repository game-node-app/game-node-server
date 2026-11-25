# Design

## Context

See `proposal.md` (Why) for motivation and `specs/*/spec.md` for behavioral contracts. Current state in `game-node-server`:

- **Adventurers Guild (`src/guild`)**: Implemented in `add-adventurers-guild` with 8 tables (`guild_profile`, `guild_reward`, `user_guild_reward`, `guild_event`, `guild_event_translation`, `guild_board_entry`, `guild_contract`, `game_time_to_beat`), 8 code-defined templates, 2 `GuildObjectiveType`s (`finish_game`, `write_review`), 13 seeded rewards, BullMQ `guild-queue`, `GuildScheduler`, and zero-extra-query `guildTitleKey`/`guildFrameKey` columns on `profile`.
- **Playtime & History (`src/playtime`)**: `PlaytimeService.save` already enqueues `guildQueueService.enqueueEvaluation(userId, "playtime")` after commit (`src/playtime/playtime.service.ts:460`). `PlaytimeHistoryService.getTotalPlaytimeForPeriod` and `getDailyPlaytimeForPeriod` already compute positive incremental deltas from `user_playtime_history` while handling first-observation lifetime totals safely.
- **GameNode Daily (`src/daily`)**: `DailyResult` (`daily_result`) stores `userId`, `puzzleId`, `status` (`won`/`lost`/`in_progress`), `hintAt` (`null` when no hint used), `attempts`, `ranked`, and `finishedAt`. Practice rounds live in a separate table (`daily_practice_round`).
- **Synced Game Achievements (`src/game/game-achievement`)**: `ObtainedGameAchievement` (`obtained_game_achievement`) stores `(profileUserId, externalGameId, externalAchievementId, obtainedAt, createdAt)`. `GameCompletionStatus` (`game_completion_status`) stores `(profileUserId, externalGameId, isCompleted, isPlatinumObtained, totalAvailableAchievements, totalObtainedAchievements, completedAt)`. Both join to `game` via `game_external_game.gameId`.
- **Posts & Collections (`src/posts`, `src/collections`)**: `Post` stores `(profileUserId, gameId, content, createdAt, deletedAt)`. `Collection` stores `(libraryUserId, name, description, isPublic, createdAt, updatedAt)` with entries in `collection_entry_to_collection`. `CollectionEntryStatusHistory` (`collection_entry_status_history`) records every status transition (`fromStatus`, `toStatus`, `source`, `occurredAt`).
- **IGDB Game Catalog (`src/game/game-repository`)**: `Game` has `firstReleaseDate`, `category`, `aggregatedRating`, `statisticsTargetId`, and join tables `game_genres_game_genre`, `game_themes_game_theme`, `game_keywords_game_keyword`, `game_franchises_game_franchise`, `game_platforms_game_platform`, `game_dlcs_game`, `game_expansions_game`, `game_remakes_game`, `game_remasters_game`.
- **Notifications (`src/notifications`)**: Transactional outbox (`appendNotificationIntent(manager, intent)`) projects individual system notifications. `NotificationTarget` already includes `{ type: "guild", contractId }`.
- **Timezone & Deterministic Ordering**: `DAILY_TIME_ZONE = "America/Sao_Paulo"`, `dailyToday(now)`, `mondayOf(...)`, and `seededOrder(seed, items, key)` in `src/guild/guild.constants.ts`.

## Goals / Non-Goals

**Goals:**

- Keep `GET /v1/profile` and `GET /v1/profile/:id` at their exact existing SQL query count (store all new Guild-only cosmetics on `guild_profile`, never on `profile`).
- Remain strictly additive and backwards-compatible with `add-adventurers-guild` clients (preserve `weekly_chest`, existing endpoints, and existing DTO shapes while adding new fields and routes).
- Avoid circular module dependencies by routing all new domain triggers (`daily`, `post`, `collection`, `game_achievement`) through the existing lightweight `GuildQueueModule`.
- Guarantee strict idempotency and race safety across Seals ledger writes, Emporium purchases, rerolls, Hourglass extensions, Rank promotions, Prestige stars, Passport claims, Quest Chain transitions, and Community Bounty contributions/claims.
- Enforce concrete anti-spam and anti-abuse rules on every new objective type before granting XP or Seals.

**Non-Goals:**

- Client UI, pixel-art assets, or Lina animations (delivered in a separate `game-node-clients` change via `handoff-clients.md`).
- Real-money purchase of Guild Seals or consumables.
- Player-to-player trading, auctions, clan guilds, or competitive Guild XP leaderboards.
- Retroactively awarding Seals for contracts claimed prior to this migration (existing users DO receive lazy one-time Rank promotion cosmetics for ranks they already attained).

## Decisions

### 1. Additive Schema & Single Migration (`1796100000000-ExpandAdventurersGuild.ts`)

All schema changes are strictly additive, checking column/table existence and using `INSERT IGNORE` for idempotent retries (matching `1795900000000-AddAdventurersGuild.ts`).

#### Alterations to existing tables:
- **`guild_profile`**:
  - `sealsBalance int unsigned NOT NULL DEFAULT 0`
  - `prestigeLevel int unsigned NOT NULL DEFAULT 0`
  - `highestPromotedRank varchar(4) NOT NULL DEFAULT 'E'`
  - `equippedLicenseThemeKey varchar(64) NULL DEFAULT NULL`
  - `equippedStampStyleKey varchar(64) NULL DEFAULT NULL`
  - `equippedDecorKeys json NULL DEFAULT NULL` (array of up to 4 `tavern_decor` keys)
  - `showcaseBadgeIds json NULL DEFAULT NULL` (array of up to 3 achievement definition IDs)
  - `freeRerollWeekStart date NULL DEFAULT NULL`, `freeRerollsUsedThisWeek tinyint unsigned NOT NULL DEFAULT 0`
  - `freeHourglassMonthKey char(7) NULL DEFAULT NULL` (`YYYY-MM` São Paulo when the Rank A/S free monthly Hourglass was last used)
  - `extraSlotPermitWeekStart date NULL DEFAULT NULL` (`YYYY-MM-DD` Monday when `extra_slot_permit` is active)
- **`guild_reward`**:
  - `rarity varchar(16) NOT NULL DEFAULT 'common'` (`common` | `uncommon` | `rare` | `epic` | `legendary`)
  - `chestBonusSeals int unsigned NOT NULL DEFAULT 0`
  - `consumableKey varchar(32) NULL DEFAULT NULL` (`hourglass` | `reroll_charter` | `extra_slot_permit`)
- **`guild_board_entry`**:
  - `cycle varchar(16) NOT NULL DEFAULT 'weekly'` (`weekly` | `monthly`)
  - `periodKey varchar(10) NULL DEFAULT NULL` (backfilled to `weekStart` for weekly rows; `YYYY-MM` for monthly expeditions; unique index updated to `UQ_guild_board_entry_user_cycle_period_slot (profileUserId, cycle, periodKey, slotIndex)` while keeping `weekStart` populated as the first day of the period for backwards compatibility)
  - `sealsReward int unsigned NOT NULL DEFAULT 0`
  - `bonusObjective json NULL DEFAULT NULL`
  - `meta json NULL DEFAULT NULL` (persists procedural display params such as `{ genreName?, franchiseName?, decade?, staleDays? }`)
  - `rerollCount tinyint unsigned NOT NULL DEFAULT 0`
- **`guild_contract`**:
  - `sealsReward int unsigned NOT NULL DEFAULT 0`
  - `bonusObjective json NULL DEFAULT NULL`
  - `bonusCompleted tinyint NOT NULL DEFAULT 0`
  - `extendedCount tinyint unsigned NOT NULL DEFAULT 0`
  - `chainProgressId varchar(36) NULL DEFAULT NULL` (FK `guild_user_chain(id) ON DELETE SET NULL`, indexed)
- **`guild_event`**:
  - `sealsReward int unsigned NOT NULL DEFAULT 0`
  - `bonusObjective json NULL DEFAULT NULL`

#### New tables:
1. **`guild_seal_ledger`**:
   - `id bigint unsigned AUTO_INCREMENT PK`, `profileUserId varchar(36)` FK `profile(userId) ON DELETE CASCADE`, `delta int NOT NULL`, `balanceAfter int unsigned NOT NULL`, `reason varchar(32) NOT NULL` (`contract_claim` | `bonus_objective` | `chest_payout` | `duplicate_fallback` | `passport_claim` | `prestige_star` | `chain_complete` | `bounty_claim` | `emporium_purchase`), `referenceId varchar(64) NULL`, `createdAt datetime(6)`. Index `IDX_guild_seal_ledger_user_created (profileUserId, createdAt)`.
2. **`guild_consumable_inventory`**:
   - `profileUserId varchar(36)`, `consumableKey varchar(32)` (`hourglass` | `reroll_charter` | `extra_slot_permit`), `quantity int unsigned NOT NULL DEFAULT 0`, `updatedAt datetime(6)`. PK `(profileUserId, consumableKey)`. FK `profile(userId) ON DELETE CASCADE`.
3. **`guild_emporium_item`**:
   - `id varchar(36) PK`, `rewardId varchar(36)` FK `guild_reward(id) ON DELETE CASCADE`, `priceSeals int unsigned NOT NULL`, `minRank varchar(4) NOT NULL DEFAULT 'E'`, `isRotating tinyint NOT NULL DEFAULT 0`, `maxPurchasesPerMonth tinyint unsigned NULL DEFAULT NULL`, `isActive tinyint NOT NULL DEFAULT 1`, `createdAt`, `updatedAt`. Index `IDX_guild_emporium_active_rotating (isActive, isRotating)`.
4. **`guild_emporium_purchase`**:
   - `id bigint unsigned AUTO_INCREMENT PK`, `profileUserId varchar(36)` FK `profile(userId) ON DELETE CASCADE`, `emporiumItemId varchar(36)` FK `guild_emporium_item(id) ON DELETE CASCADE`, `monthKey char(7) NOT NULL`, `priceSeals int unsigned NOT NULL`, `purchasedAt datetime(6)`. Index `IDX_guild_emporium_purchase_user_item_month (profileUserId, emporiumItemId, monthKey)`.
5. **`guild_passport_month`**:
   - `profileUserId varchar(36)`, `monthKey char(7)` (`YYYY-MM` São Paulo), `completedContractsCount int unsigned NOT NULL DEFAULT 0`, `claimedMilestones json NOT NULL` (`number[]`, e.g. `[2, 4]`), `updatedAt datetime(6)`. PK `(profileUserId, monthKey)`. FK `profile(userId) ON DELETE CASCADE`.
6. **`guild_user_chain`**:
   - `id varchar(36) PK`, `profileUserId varchar(36)` FK `profile(userId) ON DELETE CASCADE`, `chainKey varchar(64) NOT NULL`, `status varchar(16) NOT NULL DEFAULT 'in_progress'` (`in_progress` | `completed`), `currentStageIndex tinyint unsigned NOT NULL DEFAULT 0`, `boundTargetGameId bigint NULL DEFAULT NULL` FK `game(id) ON DELETE SET NULL`, `activeContractId varchar(36) NULL DEFAULT NULL`, `startedAt datetime(6)`, `completedAt datetime(6) NULL`. `UNIQUE (profileUserId, chainKey)`.
7. **`guild_community_bounty`** & **`guild_community_bounty_translation`**:
   - `guild_community_bounty`: `id varchar(36) PK`, `slug varchar(64) UNIQUE`, `title varchar(120)`, `description varchar(500)`, `objectiveType varchar(32)`, `criteria json`, `targetTotal int unsigned NOT NULL`, `currentTotal int unsigned NOT NULL DEFAULT 0`, `minUserContribution int unsigned NOT NULL DEFAULT 1`, `maxUserContributionCap int unsigned NOT NULL`, `milestoneRewards json NOT NULL` (`{ "25": {...}, "50": {...}, "100": {...}, "150": {...} }`), `startsAt datetime`, `endsAt datetime`, `status varchar(16) DEFAULT 'draft'`, `publishedAt datetime NULL`, `reached100At datetime(6) NULL`, `createdAt`, `updatedAt`. Index `IDX_guild_bounty_status_window (status, startsAt, endsAt)`.
   - `guild_community_bounty_translation`: mirrors `guild_event_translation` (`en`, `pt-BR`).
8. **`guild_community_bounty_contribution`**:
   - `id bigint unsigned AUTO_INCREMENT PK`, `bountyId varchar(36)` FK `guild_community_bounty(id) ON DELETE CASCADE`, `profileUserId varchar(36)` FK `profile(userId) ON DELETE CASCADE`, `sourceKey varchar(128) NOT NULL` (e.g., `game:1029`, `daily:44`, `post:<uuid>`), `units int unsigned NOT NULL DEFAULT 1`, `contributedAt datetime(6)`. `UNIQUE (bountyId, profileUserId, sourceKey)`. Index `IDX_guild_bounty_contrib_user (bountyId, profileUserId)`.
9. **`guild_community_bounty_claim`**:
   - `bountyId varchar(36)`, `profileUserId varchar(36)`, `claimedMilestones json NOT NULL` (`number[]`), `notifiedReadyAt datetime(6) NULL DEFAULT NULL`, `updatedAt datetime(6)`. PK `(bountyId, profileUserId)`. FKs cascade on delete.

### 2. Rebalanced Economy, 20-Template Catalog & Rank Scaling

#### Base XP & Seals per Rank
| Rank | Base XP Range | Base Seals | Primary Chest Tier | Typical Duration |
| --- | --- | --- | --- | --- |
| `E` | 60–100 | 10 | None or `chest_bronze` | 7 days |
| `D` | 120–180 | 20 | `chest_bronze` | 7 days |
| `C` | 220–320 | 35 | `chest_silver` | 7–21 days |
| `B` | 360–500 | 60 | `chest_silver` / `badge` | 14–21 days |
| `A` | 650–900 | 110 | `chest_gold` | 30–45 days |
| `S` | 1,200–1,500 | 200 | `chest_relic` | 45–60 days |

Global XP conversion remains `floor(guildXpAwarded × 0.25)`.

#### Expanded System Template Catalog (20 templates)

| Slot / Cycle | `templateKey` | Rank | Min Rank | XP | Seals | Objective | Target | Duration | Reward | Notes / Procedural Criteria |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `library` (weekly) | `recent_dust` | C | E | 260 | 35 | `finish_game` | 1 | 21d | `chest_silver` | Backlog ≥ 90d untouched (`requiresTargetGame: true`); unlocks relic gameplay for < 1yr accounts |
| `library` (weekly) | `forgotten_relic` | B | E | 420 | 60 | `finish_game` | 1 | 21d | `badge_archaeologist` | Backlog ≥ 365d untouched; duplicate badge now grants +50 XP & +25 Seals |
| `library` (weekly) | `deep_dive` | C | E | 240 | 35 | `finish_game` | 1 | 21d | `chest_silver` | Currently `playing` game (`requiresTargetGame: true`) |
| `library` (weekly) | `off_the_map` | B | D | 400 | 60 | `finish_game` | 1 | 21d | `chest_silver` | Procedural: underrepresented genre in user's finished games present in backlog |
| `library` (weekly) | `continue_the_saga` | C | D | 300 | 40 | `finish_game` | 1 | 21d | `chest_silver` | Procedural: franchise with ≥ 1 finished & ≥ 1 unfinished game |
| `library` (weekly) | `time_machine` | C | E | 280 | 35 | `finish_game` | 1 | 21d | `chest_silver` | Procedural: release decade with ≥ 2 unfinished library games |
| `library` (weekly) | `return_to_the_world` | C | D | 270 | 35 | `finish_game` | 1 | 21d | `chest_silver` | Procedural: unfinished DLC/expansion/remake of a game user finished |
| `library` (weekly) | `hidden_gem` | C | D | 290 | 40 | `finish_game` | 1 | 21d | `chest_silver` | Procedural: low-popularity / indie unfinished library game |
| `weekly` | `short_caravan` | D | E | 170 | 20 | `finish_game` | 1 | 7d | `chest_bronze` | `maxTimeToBeatHours: 8`, `isQuick: true` |
| `weekly` | `weekend_sprint` | D | E | 160 | 20 | `finish_game` | 1 | 7d | `chest_bronze` | Any game, `isQuick: true` |
| `weekly` | `double_feature` | C | D | 310 | 40 | `finish_game` | 2 | 7d | `chest_silver` | Finish 2 distinct games |
| `weekly` | `field_vigil` | D | E | 140 | 20 | `log_playtime` | 240 (min) | 7d | `chest_bronze` | Log 4 hours of incremental playtime, `isQuick: true` |
| `weekly` | `backlog_taste_test` | D | E | 150 | 20 | `log_playtime` | 2 (games) | 7d | `chest_bronze` | `minPlaytimeSecondsPerGame: 2700` (45m on 2 `planned` games), `isQuick: true` |
| `weekly` | `campaign_rhythm` | D | E | 150 | 20 | `play_distinct_days` | 4 (days) | 7d | `chest_bronze` | Play ≥ 15m on 4 distinct São Paulo days |
| `weekly` | `trophy_hunter` | C | D | 230 | 35 | `earn_game_achievements` | 10 | 7d | `chest_silver` | Only offered to users with synced external achievements |
| `gamenode` (weekly) | `captains_log` | E | E | 90 | 15 | `write_review` | 1 | 7d | `title_chronist` | `finishedInCurrentMonth: true`, `isQuick: true` |
| `gamenode` (weekly) | `quick_take` | E | E | 70 | 10 | `write_review` | 1 | 7d | `null` (pure XP+Seals) | Rebalanced: no chest for 1 short review, `isQuick: true` |
| `gamenode` (weekly) | `on_duty_critic` | D | E | 150 | 20 | `write_review` | 3 | 7d | `chest_bronze` | 3 distinct games, ≥ 80 chars |
| `gamenode` (weekly) | `deep_critic` | C | D | 220 | 35 | `write_review` | 2 | 7d | `chest_silver` | `minReviewChars: 200` |
| `gamenode` (weekly) | `guild_oracle` | E | E | 90 | 15 | `daily_challenge` | 3 | 7d | `chest_bronze` | Win 3 GameNode Daily puzzles, `isQuick: true` |
| `gamenode` (weekly) | `eagle_eye` | C | D | 230 | 35 | `daily_challenge` | 2 | 7d | `chest_silver` | `requireNoDailyHint: true`, `maxDailyAttempts: 3` |
| `gamenode` (weekly) | `cartographer` | E | E | 85 | 15 | `curate_collection` | 1 | 7d | `chest_bronze` | Public collection with ≥ 5 games + ≥ 20-char description, `isQuick: true` |
| `gamenode` (weekly) | `expedition_log` | E | E | 75 | 10 | `publish_post` | 1 | 7d | `null` | Post with ≥ 80 plain-text chars + game, `isQuick: true` |
| `gamenode` (weekly) | `pack_cleanup` | E | E | 80 | 15 | `triage_backlog` | 3 | 7d | `chest_bronze` | Triage 3 games `planned` ≥ 30 days, `isQuick: true` |
| `monthly` (slot 3) | `the_colossus` | A | C | 750 | 110 | `finish_game` | 1 | 45d | `chest_gold` | `minTimeToBeatHours: 35`, `requiresTargetGame: true` |
| `monthly` (slot 3) | `ancient_fossil` | A | C | 720 | 110 | `finish_game` | 1 | 45d | `chest_gold` | Untouched ≥ 1,095d (or oldest ≥ 2yr), `requiresTargetGame: true` |
| `monthly` (slot 3) | `genre_marathon` | A | C | 780 | 120 | `finish_game` | 3 | 30d | `chest_gold` | Procedural genre with ≥ 3 unfinished library games |
| `monthly` (slot 3) | `deep_critic_anthology` | A | C | 650 | 100 | `write_review` | 5 | 30d | `chest_gold` | `minReviewChars: 250` |
| `monthly` (slot 3) | `platinum_crown` | S | A | 1,350 | 200 | `complete_game_100` | 1 | 60d | `chest_relic` | Synced accounts only; `totalAvailableAchievements >= 5` |
| `monthly` (slot 3) | `colossus_legend` | S | A | 1,400 | 200 | `finish_game` | 1 | 60d | `chest_relic` | `minTimeToBeatHours: 60`, `requiresTargetGame: true` |
| `monthly` (slot 3) | `saga_trilogy` | S | A | 1,300 | 200 | `finish_game` | 3 | 60d | `chest_relic` | Procedural franchise/theme with ≥ 3 unfinished games |

*(Note: 24 weekly-pool templates + 7 monthly expedition templates = 31 templates total, all code-defined in `guild-templates.constants.ts` with clean fallback so even an empty library always produces a valid 3-slot weekly board and an eligible Rank `C+` monthly expedition via `deep_critic_anthology`.)*

### 3. Evaluator Architecture & Anti-Abuse Strategy

Split `GuildContractEvaluatorService` cleanly into objective evaluator strategies (a plain map `Record<GuildObjectiveType, EvaluatorFn>` inside `src/guild/evaluators/` — no over-engineered DI plugin framework):

- **`log_playtime` & `play_distinct_days`**: Reuse `PlaytimeHistoryService.getTotalPlaytimeForPeriod` and `getDailyPlaytimeForPeriod`!
  - Important subtlety: `getTotalPlaytimeForPeriod` includes `firstObservationSpread` for Steam/Xbox first syncs. For Guild contracts, we add a strict boolean option `excludeInitialObservations: true` (or query only `GREATEST(ph.totalPlaytimeSeconds - previous, 0)` where `previous IS NOT NULL`) so connecting a new platform account with historical playtime **never** auto-completes a Guild playtime contract.
  - `play_distinct_days` groups deltas by `DATE(CONVERT_TZ(ph.createdAt, '+00:00', '-03:00'))` (matching `DAILY_TIME_ZONE` fixed `-03:00` shortcut used across `daily.constants.ts`) and counts days with `SUM(deltaSeconds) >= 900`.
- **`daily_challenge`**: Queries `daily_result` where `userId = ? AND status = 'won' AND finishedAt >= acceptedAt AND finishedAt < expiresAt AND finishedAt <= now`, plus optional `hintAt IS NULL` and `attempts <= maxDailyAttempts`. Enqueue hook added in `DailyService` right after a winning `DailyResult` commits.
- **`earn_game_achievements` & `complete_game_100`**:
  - `earn_game_achievements` queries `obtained_game_achievement oga INNER JOIN game_external_game geg ON geg.id = oga.externalGameId` filtering `oga.obtainedAt >= acceptedAt AND oga.createdAt >= acceptedAt` (both timestamps required so backdating or initial backfill imports cannot fulfill contracts).
  - `complete_game_100` queries `game_completion_status gcs INNER JOIN game_external_game geg ON geg.id = gcs.externalGameId` filtering `(gcs.isCompleted = 1 OR gcs.isPlatinumObtained = 1) AND gcs.completedAt >= acceptedAt AND gcs.totalAvailableAchievements >= 5`.
  - Enqueue hook added in `GameObtainedAchievementService` and `GameAchievementStatusService` after commit.
- **`curate_collection`**: Queries `collection c` owned by `userId` with `c.isPublic = 1`, `CHAR_LENGTH(TRIM(COALESCE(c.description, ''))) >= 20`, `c.updatedAt >= acceptedAt`, `(SELECT COUNT(DISTINCT gameId) FROM collection_entry_to_collection m INNER JOIN collection_entry ce ON ce.id = m.collectionEntryId WHERE m.collectionId = c.id) >= minCollectionEntries`, excluding collection IDs recorded in `claimPayload.creditedCollectionIds` of the user's completed `curate_collection` contracts within the last 30 days. Enqueue hook added in `CollectionsService`.
- **`publish_post`**: Queries `post p` where `p.profileUserId = ? AND p.deletedAt IS NULL AND p.createdAt >= acceptedAt` and strips HTML tags in Node before checking `plainText.trim().length >= minPostChars` (default 80), counting distinct `gameId`s. Enqueue hook added in `PostsService.create`.
- **`triage_backlog`**: Queries `collection_entry_status_history h` where `h.libraryUserId = ? AND h.source = 'manual' AND h.fromStatus = 'planned' AND h.toStatus IN ('playing', 'finished', 'dropped') AND h.occurredAt >= acceptedAt`, AND verifying the entry existed in `planned` status at least 30 days before `acceptedAt` (`COALESCE(ce.plannedAt, ce.createdAt) <= acceptedAt - 30d` or an earlier history row transitioning to `planned` ≤ `acceptedAt - 30d`).

### 4. Bonus Objectives Design

- Stored as structured JSON on `guild_board_entry`, `guild_event`, and snapshotted onto `guild_contract`:
  ```ts
  export type GuildBonusObjective = {
      type: "also_write_review" | "finish_before_half_deadline" | "use_stale_backlog_game";
      minChars?: number;           // for also_write_review (default 150)
      staleDays?: number;          // for use_stale_backlog_game (default 180)
      bonusXp?: number;
      bonusSeals?: number;
      upgradeChestTier?: boolean;  // bronze -> silver -> gold -> relic
  };
  ```
- Weekly/library templates deterministically attach a compatible `bonusObjective` on ~50% of generated slots using `seed` (e.g., `finish_game` contracts may get `also_write_review` or `finish_before_half_deadline`) so cards feel varied and rewarding without overwhelming every quest.
- Evaluation: `finish_before_half_deadline` and `use_stale_backlog_game` are checked when marking `ready_to_claim` (persisted on `bonusCompleted`); `also_write_review` is also re-checked at `claimContract` time so a player who finishes the game, writes their review right after, and then turns in the contract gets full credit!

### 5. Chest Tiers, Rarity Pools & Upgrade Chain

- Chest upgrade ladder: `chest_bronze` → `chest_silver` → `chest_gold` → `chest_relic` (`weekly_chest` maps to `chest_silver` in the ladder).
- Each chest reward specifies `chestBonusXp` and `chestBonusSeals`:
  - `chest_bronze`: +40 XP, +15 Seals, pool: `common`, exhausted fallback: +50 XP, +25 Seals
  - `chest_silver` / `weekly_chest`: +75 XP, +30 Seals, pool: `uncommon` (fallback `common`), exhausted fallback: +50 XP, +45 Seals
  - `chest_gold`: +125 XP, +60 Seals, pool: `rare` (fallback `uncommon`), 35% deterministic chance of 1 consumable (`hourglass` or `reroll_charter`), exhausted fallback: +50 XP, +80 Seals
  - `chest_relic`: +200 XP, +120 Seals, pool: `legendary`/`epic` (fallback `rare`), guaranteed 1 consumable (`hourglass`, `reroll_charter`, or `extra_slot_permit`), exhausted fallback: +50 XP, +150 Seals
- All rolls use `seededOrder(sha256(userId + ":" + sourceId), ...)` — zero `Math.random()`, fully deterministic and testable.

### 6. Locking Order & Transaction Safety

To prevent deadlocks across all new atomic flows, enforce a strict lock acquisition order everywhere:
1. `guild_contract` (when operating on a specific contract)
2. `guild_user_chain` (when advancing/starting a chain)
3. `guild_profile` (always locked `FOR UPDATE` before mutating `xp`, `rank`, `prestigeLevel`, `sealsBalance`, reroll counters, or consumable inventory)
4. `guild_passport_month` / `guild_emporium_item` / `guild_event` / `guild_community_bounty`

For **Community Bounties** high-concurrency increments:
- Individual contributions insert into `guild_community_bounty_contribution` (`INSERT IGNORE` on `(bountyId, profileUserId, sourceKey)`).
- Only when `affectedRows === 1` AND the user's current contribution count is below `maxUserContributionCap`, run an atomic `UPDATE guild_community_bounty SET currentTotal = currentTotal + ?, reached100At = CASE WHEN reached100At IS NULL AND currentTotal + ? >= targetTotal THEN ? ELSE reached100At END WHERE id = ?`.
- When `reached100At` transitions from `NULL` to non-null (or on a fast periodic sweep in `GuildScheduler` for bounties with `reached100At IS NOT NULL`), fan out `guild.community-bounty-ready` notification intents in bounded batches (up to 500 unnotified eligible contributors per tick via `guild_community_bounty_claim.notifiedReadyAt IS NULL`), avoiding locking a huge user set inside a single player's write transaction!

### 7. Background TTB Prefetch

Add a second hourly/periodic task inside `GuildScheduler` (`@Cron("45 * * * *", { timeZone: DAILY_TIME_ZONE })`):
- Finds up to 80 distinct uncached/stale `gameId`s from `collection_entry` (`planned`/`playing`) belonging to Guild members who visited within the last 30 days.
- Calls `GuildTimeToBeatService.getForGameIds(batch, now)` in chunks of 40 (reusing `IgdbOutboundBudgetService` and existing 30-day negative caching).
- Never blocks user requests; logs and skips gracefully on IGDB quota or outage.

### 8. Module Organization (Keeping `src/guild` Maintainable)

Rather than bloating `GuildContractsService` and `GuildBoardService`, decompose cleanly inside `src/guild/`:
- `src/guild/evaluators/` — focused objective evaluator helpers (`finish-game`, `write-review`, `playtime`, `daily`, `game-achievements`, `community-content`, `triage-backlog`, `bonus-objective`).
- `src/guild/guild-procedural-board.service.ts` — library-DNA queries (`off_the_map`, `continue_the_saga`, `time_machine`, `hidden_gem`, `return_to_the_world`, `the_colossus`, `genre_marathon`, `saga_trilogy`) and Monthly Expedition generation.
- `src/guild/guild-seals.service.ts` — atomic Seals ledger credit/debit + consumable inventory helpers.
- `src/guild/guild-emporium.service.ts` — Emporium showcase rotation, purchases, and admin CRUD.
- `src/guild/guild-passport.service.ts` — Monthly Passport stamp tracking and milestone claims.
- `src/guild/guild-chains.service.ts` — Quest Chain definitions, start/advance, and stage completion hooks.
- `src/guild/guild-bounties.service.ts` — Community Bounty contribution recording, milestone claims, ready-notification fan-out, and admin CRUD.
- `src/guild/guild-rank-progression.service.ts` — Rank promotion package granting (including lazy reconciliation for pre-migration members) and Prestige `S+` star rewards.

## Risks / Trade-offs

- **[Large surface area in one change]** → Mitigated by strict modular decomposition (8 focused services + objective evaluators), wave-ordered implementation tasks (Wave 1: Schema/Economy/Evaluators → Wave 2: Procedural Board/Monthly Expeditions/Rerolls/Emporium/Passport → Wave 3: Chains/Community Bounties/Notifications/Hand-off), and comprehensive integration test coverage per module.
- **[Anti-spam arms race on low-friction objectives (`triage_backlog`, `curate_collection`, `publish_post`)]** → Mitigated by explicit DB-enforced gates: 30-day pre-existing `planned` age for `triage_backlog`, 30-day per-collection cooldown + 5-game/20-char description minimum for `curate_collection`, HTML-stripped 80-char minimum + distinct game for `publish_post`, and modest Rank `E` XP/Seals rewards (`70–90 XP`, `10–15 Seals`) so content farming is never more efficient than actual gameplay.
- **[Community Bounty fan-out notifications for large user bases]** → Mitigated by decoupled batched fan-out in `GuildScheduler` (500 eligible contributors per tick, guarded by `notifiedReadyAt IS NULL` on `guild_community_bounty_claim`) instead of synchronous mass inserts during a player's mutation.
- **[`add-adventurers-guild` not yet archived to `openspec/specs/`]** → All changes here build directly on the implemented `src/guild/**` code; once `add-adventurers-guild` is archived, these deltas merge cleanly without conflict.
- **[Hotspot contention on `guild_community_bounty.currentTotal` during peak events]** → Updates only execute once per deduplicated `(bountyId, profileUserId, sourceKey)` inside async BullMQ workers (already 2s-debounced per user), keeping lock duration to a single indexed PK update.
- **[IGDB quota consumption from background TTB prefetch]** → Strictly bounded to 80 uncached IDs/hour (~2 batched IGDB requests/hour) and routed through `IgdbOutboundBudgetService` with 30-day negative caching.

## Migration Plan

1. Deploy migration `1796100000000-ExpandAdventurersGuild` alongside the application release:
   - Adds nullable/defaulted columns on existing Guild tables (`guild_profile`, `guild_reward`, `guild_board_entry`, `guild_contract`, `guild_event`) and backfills `guild_board_entry.periodKey = weekStart`.
   - Creates the 9 new Guild tables.
   - Seeds the 4 tiered chests, rank promotion cosmetics, expanded 25+ cosmetic chest pool across rarities, license themes, stamp styles, tavern decor items, 3 consumables, quest chain cosmetics, and initial Emporium catalog via `INSERT IGNORE`.
2. Existing users keep all XP, Rank, active contracts, and unlocked cosmetics; on their next `GET /v1/guild` read, `GuildRankProgressionService` lazily reconciles any missed Rank promotion packages for their current Rank without duplicating rewards.
3. Rollback: revert application code (older code ignores new nullable/defaulted columns and new tables); migration `down` drops the new tables and columns while preserving user-unlocked starter rewards.
