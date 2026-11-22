# Design

## Context

See `proposal.md` (Why) for motivation and `specs/*/spec.md` for behavioral contracts. Current state in `game-node-server`:

- **XP & Levels (`src/level`)**: `UserLevel` stores global levels 1–50 (`currentLevel`, `currentLevelExp`, `levelUpExpCost`). `LevelService.increaseExp(userId, amount, manager?)` already accepts an `EntityManager` and locks `UserLevel` with `pessimistic_write` inside a transaction.
- **Achievements (`src/achievements`)**: `AchievementDefinition` (with `status`, `metric: "manual"`, `tiers`) and `ObtainedAchievement` already exist. `AchievementsProgressService.grantTiers(userId, definition, [1], mode)` idempotently grants tiers, increments `obtainedCount`, emits `achievement.unlocked`, and registers a feed activity, though it currently opens its own `dataSource.transaction`.
- **Library, Reviews & Playtime (`src/collections`, `src/reviews`, `src/playtime`)**:
  - `CollectionEntry` stores `status` (`planned`, `playing`, `finished`, `dropped`, `ongoing`), `plannedAt`, `startedAt`, `finishedAt`, `droppedAt`, `createdAt`, `updatedAt`. `CollectionsEntriesService.createOrUpdate` already enqueues `AchievementsQueueService.addTrackingJob` after commit.
  - `Review` stores `profileUserId`, `gameId`, `createdAt`, `collectionEntryId`. `ReviewsService.createOrUpdate` already enqueues `achievementsQueueService.addTrackingJob` on new reviews.
  - `UserPlaytime` stores `profileUserId`, `gameId`, `totalPlaytimeSeconds`, `lastPlayedDate` across multiple sources/platforms; `PlaytimeService.findAccumulatedForUserIdAndGameId` sums them.
  - `TimeToBeatService` (`src/playtime/time-to-beat/time-to-beat.service.ts`) queries IGDB `game_time_to_beats` (`hastily`, `normally`, `completely`, `count`) via `IgdbPlaytimeSyncService` with a 30-minute Redis cache and `IgdbOutboundBudgetService`, with **no local MySQL persistence**.
- **Yearly Goals (`src/recap`)**: `YearGoal` (`year_goal`) and `RecapGoalsService.getGoal(userId, year)` already track per-year finished-games targets (`{ year, target, finished }`)!
- **Profile Reads (`src/profile`)**: `GET /v1/profile/:id` is the hottest read in the application (`UserAvatar` calls it per distinct user). `add-supporter-profile-perks` established the invariant that public reads for non-supporters must not gain extra SQL statements. `ProfileSupporterPreferences` holds time-dependent supporter perks (`titleKey`, `showAnimatedAvatarBorder`, etc.) in a separate table so lapsed perks never leak.
- **Notifications (`src/notifications`)**: Transactional outbox (`appendNotificationIntent(manager, intent)`) → BullMQ relay → `NotificationsProjectorService` → inbox items. `goal.reminder` and `achievement.unlocked` are already projected as individual system notifications with typed targets.
- **Scheduling & Timezone (`src/daily`)**: `DAILY_TIME_ZONE = "America/Sao_Paulo"` and `mondayOf(dailyToday())` define GameNode's Monday-to-Sunday weekly boundary.
- **Translations (`src/awards`)**: `add-awards-category-translations` established the normalized child translation table (`en`, `pt-BR`) returned as `translations: [{ locale, title, description }]` with base fields as fallback and no `locale` query parameter.

Design frames (Figma `rvZfYT3eR8ktZAW6g3HO8C`, page `0:1` and components `2:62`):

| Frame | Node | Data it reads / writes |
| --- | --- | --- |
| Desktop — Guilda dos Aventureiros | `6:2` | `GET /v1/guild`, `GET /v1/guild/board` (`?quick=true`), `POST /v1/guild/board/seen`, `GET /v1/guild/contracts` |
| Mobile — Guilda dos Aventureiros | `8:268` | Same endpoints (condensed layout) |
| Estado — Pedido aceito | `9:387` | `POST /v1/guild/contracts` (returns stamped contract + Lina confirmation context) |
| Lina — Ficha da personagem & animações | `10:409` | `lina: { trigger, pose, context, hasUnseenBoard }` on `GET /v1/guild` and claim response (`POST /v1/guild/contracts/:id/claim`) |
| Componentes & sprites (Tags, Rank, Quest Card) | `2:62` | Categories (`library`, `event`, `weekly`, `gamenode`, plus `yearGoal`), Ranks (`E`–`S`), reward descriptors |

## Goals / Non-Goals

**Goals:**

- Keep `GET /v1/profile` and `GET /v1/profile/:id` at their exact existing SQL statement count while exposing equipped Guild titles and avatar frames.
- Avoid module dependency cycles between `GuildModule` and `CollectionsEntriesModule` / `ReviewsModule` / `PlaytimeModule` / `ProfileModule`.
- Make contract acceptance, readiness transition, and turn-in claim strictly idempotent and race-safe under concurrent requests and queue retries.
- Shield board generation and contract reads from IGDB rate limits or outages via a local MySQL `game_time_to_beat` cache.
- Reuse existing `YearGoal`, `LevelService`, `AchievementsProgressService`, and `NotificationsOutbox` instead of building parallel copies.

**Non-Goals:**

- Replacing or unifying `UserLevel` (1–50) with Guild Ranks (`E`–`S`); Guild XP is its own progression ladder that also credits `UserLevel` on claim.
- Server-side localization of system quest copy or Lina dialogue prose; clients localize from stable `templateKey` / `trigger` + structured `context` params (only admin-authored curated events store `en`/`pt-BR` text).
- Real-time WebSocket push for contract readiness (delivered through existing notifications inbox and next Guild read).
- Backfilling historical actions into newly accepted contracts.

## Decisions

### 1. Data model and single migration (`1795900000000-AddAdventurersGuild.ts`)

Eight new tables plus two nullable columns on `profile`:

- **`guild_profile`**:
  - `profileUserId varchar(36) PK` FK `profile(userId) ON DELETE CASCADE`
  - `licenseNumber int unsigned NOT NULL AUTO_INCREMENT` with `UNIQUE KEY UQ_guild_profile_license_number (licenseNumber)` (InnoDB supports `AUTO_INCREMENT` on a non-PK column when it is the leading column of a key)
  - `xp int unsigned NOT NULL DEFAULT 0`
  - `rank varchar(4) NOT NULL DEFAULT 'E'`
  - `lastBoardSeenAt datetime(6) NULL`
  - `lastVisitedAt datetime(6) NULL`
  - `createdAt`, `updatedAt`
  - Lazy creation uses `INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)` followed by a read so concurrent first visits never collide.
- **`profile` additions**:
  - `guildTitleKey varchar(64) NULL DEFAULT NULL`
  - `guildFrameKey varchar(64) NULL DEFAULT NULL`
  - Why on `profile` instead of a separate table (unlike `profile_supporter_preferences`): Guild cosmetics are permanent unlocks that never lapse with billing state, and storing two nullable strings directly on `profile` keeps `GET /v1/profile/:id` at zero additional SQL queries while making them available wherever `Profile` is already loaded.
  - Alternative rejected: a `LEFT JOIN` to `guild_profile` on every `ProfileService.findOneById`. Adds join overhead to every avatar read and couples `ProfileModule` to `GuildModule`.
- **`guild_reward`**:
  - `id varchar(36) PK`, `key varchar(64) UNIQUE`, `kind varchar(24)` (`badge` | `title` | `avatar_frame` | `weekly_chest`), `achievementId varchar(36) NULL` FK `achievement_definition(id) ON DELETE SET NULL`, `inChestPool tinyint NOT NULL DEFAULT 0`, `chestBonusXp int unsigned NOT NULL DEFAULT 0`, `isActive tinyint NOT NULL DEFAULT 1`, `createdAt`, `updatedAt`.
- **`user_guild_reward`**:
  - `id bigint unsigned AUTO_INCREMENT PK`, `profileUserId varchar(36)` FK `profile(userId) ON DELETE CASCADE`, `rewardId varchar(36)` FK `guild_reward(id) ON DELETE CASCADE`, `sourceContractId varchar(36) NULL`, `unlockedAt datetime(6)`, `UNIQUE (profileUserId, rewardId)`.
- **`guild_event`** & **`guild_event_translation`**:
  - `guild_event`: `id varchar(36) PK`, `slug varchar(64) UNIQUE`, `title varchar(120)`, `description varchar(500)`, `rank varchar(4)`, `xpReward int unsigned`, `objectiveType varchar(32)` (`finish_game` | `write_review`), `targetCount int unsigned DEFAULT 1`, `criteria json`, `rewardId varchar(36) NULL` FK `guild_reward(id) ON DELETE SET NULL`, `startsAt datetime`, `endsAt datetime`, `status varchar(16) DEFAULT 'draft'`, `publishedAt datetime NULL`, `createdAt`, `updatedAt`. Index `IDX_guild_event_status_window (status, startsAt, endsAt)`.
  - `guild_event_translation`: `id bigint unsigned AUTO_INCREMENT PK`, `eventId varchar(36)` FK `guild_event(id) ON DELETE CASCADE`, `locale varchar(10)`, `title varchar(120)`, `description varchar(500)`, `UNIQUE (eventId, locale)`.
- **`guild_board_entry`**:
  - `id varchar(36) PK`, `profileUserId varchar(36)` FK `profile(userId) ON DELETE CASCADE`, `weekStart date`, `slotIndex tinyint unsigned`, `category varchar(16)` (`library` | `weekly` | `gamenode`), `templateKey varchar(64)`, `rank varchar(4)`, `xpReward int unsigned`, `objectiveType varchar(32)`, `targetCount int unsigned DEFAULT 1`, `criteria json`, `candidateGames json` (`Array<{ gameId: number; sinceYear?: number; estimatedHours?: number }>`), `requiresTargetGame tinyint DEFAULT 0`, `rewardId varchar(36) NULL` FK `guild_reward(id) ON DELETE SET NULL`, `isRecommended tinyint DEFAULT 0`, `isQuick tinyint DEFAULT 0`, `expiresAt datetime`, `createdAt`.
  - `UNIQUE (profileUserId, weekStart, slotIndex)` so concurrent board generation for the same user/week is idempotent (`INSERT IGNORE` + reread).
- **`guild_contract`**:
  - `id varchar(36) PK`, `profileUserId varchar(36)` FK `profile(userId) ON DELETE CASCADE`, `boardEntryId varchar(36) NULL` FK `guild_board_entry(id) ON DELETE SET NULL`, `eventId varchar(36) NULL` FK `guild_event(id) ON DELETE SET NULL`, `category varchar(16)` (`library` | `event` | `weekly` | `gamenode`), `templateKey varchar(64) NULL`, `rank varchar(4)`, `xpReward int unsigned`, `objectiveType varchar(32)`, `criteria json`, `targetGameId bigint NULL` FK `game(id) ON DELETE SET NULL`, `progressCurrent int unsigned DEFAULT 0`, `progressTarget int unsigned DEFAULT 1`, `status varchar(20) DEFAULT 'active'`, `rewardId varchar(36) NULL` FK `guild_reward(id) ON DELETE SET NULL`, `claimPayload json NULL`, `acceptedAt datetime(6)`, `readyAt datetime(6) NULL`, `claimedAt datetime(6) NULL`, `expiresAt datetime NULL`, `createdAt`, `updatedAt`.
  - Indexes: `IDX_guild_contract_user_status (profileUserId, status, updatedAt)`, `IDX_guild_contract_user_board (profileUserId, boardEntryId)`, `IDX_guild_contract_user_event (profileUserId, eventId)`, `IDX_guild_contract_status_expires (status, expiresAt)`.
- **`game_time_to_beat`**:
  - `gameId bigint PK` FK `game(id) ON DELETE CASCADE`, `hastilySeconds int unsigned NULL`, `normallySeconds int unsigned NULL`, `completelySeconds int unsigned NULL`, `submitCount int unsigned DEFAULT 0`, `fetchedAt datetime`.
  - Index `IDX_game_ttb_normally (normallySeconds)`.

Starter seed inside the migration:
- Seed `AchievementDefinition` `guild-archaeologist` (`metric: "manual"`, `status: "published"`, `category: AchievementCategory.COLLECTIONS`, tier 1 `threshold: 1, expReward: 0` so contract XP is not double-counted when claiming `Relíquia Esquecida`).
- Seed starter `guild_reward` rows: `badge_archaeologist` (linked to `guild-archaeologist`), `title_chronist`, `weekly_chest` (`chestBonusXp: 75`), plus chest-pool cosmetics (`title_backlog_slayer`, `title_guild_veteran`, `frame_parchment_seal`, `frame_lantern_glow`).

### 2. Rank thresholds and pure calculation

Defined in `src/guild/guild.constants.ts` as a single ordered table and pure function `computeGuildRank(xp: number)`:

| Rank | Min XP | Next Rank |
| --- | --- | --- |
| `E` | 0 | `D` (300) |
| `D` | 300 | `C` (800) |
| `C` | 800 | `B` (2,000) |
| `B` | 2,000 | `A` (4,000) |
| `A` | 4,000 | `S` (7,500) |
| `S` | 7,500 | `null` |

Matches the Figma License (`1,240 XP` → `RANK C`, `2,000 XP` for Rank B, `760 XP` remaining). `guild_profile.rank` is updated from `computeGuildRank(xp)` inside every XP write so indexed queries/filters never drift from the formula.

### 3. Weekly board generation and template catalog

Board cycles reuse `DAILY_TIME_ZONE` (`America/Sao_Paulo`) and `mondayOf(dailyToday())` from `src/daily/daily.constants.ts` (extract or import the shared pure helper). `nextRefreshAt` is `new Date(`${addDays(weekStart, 7)}T00:00:00-03:00`)`.

System templates live in `src/guild/guild-templates.constants.ts` (code-defined, stable `templateKey`s):
- **`forgotten_relic`** (`library`, Rank `B`, `+250 XP`, `requiresTargetGame: true`, `rewardKey: "badge_archaeologist"`): finish a `collection_entry` in `planned` (or `dropped`) created/planned > 365 days ago with no `user_playtime.lastPlayedDate` in the last 365 days. Picks up to 3 oldest eligible backlog games as `candidateGames` with `sinceYear`.
- **`deep_dive`** (`library`, Rank `C`, `+200 XP`, `requiresTargetGame: true`, `rewardKey: "weekly_chest"`): finish a `collection_entry` currently in `playing` status. Fallback when user has no stale backlog games.
- **`short_caravan`** (`weekly`, Rank `D`, `+150 XP`, `isQuick: true`, `requiresTargetGame: false`, `criteria: { maxTimeToBeatHours: 8 }`, `rewardKey: "weekly_chest"`): finish any game whose cached TTB (`normallySeconds ?? hastilySeconds`) is `<= 28,800s`. Populates up to 3 short games from the user's `planned`/`playing` library (hydrated via `GuildTimeToBeatService`) with `estimatedHours`.
- **`weekend_sprint`** (`weekly`, Rank `D`, `+140 XP`, `isQuick: true`, `requiresTargetGame: false`, `criteria: {}`, `rewardKey: "weekly_chest"`): finish any game in your library this week. Used in weekly rotation or as fallback if TTB lookup returns no short games.
- **`captains_log`** (`gamenode`, Rank `E`, `+80 XP`, `isQuick: true`, `objectiveType: "write_review"`, `targetCount: 1`, `criteria: { finishedInCurrentMonth: true }`, `rewardKey: "title_chronist"`): write 1 review for a game finished this calendar month.
- **`on_duty_critic`** (`gamenode`, Rank `D`, `+120 XP`, `isQuick: false`, `objectiveType: "write_review"`, `targetCount: 3`, `criteria: {}`, `rewardKey: "weekly_chest"`): write 3 reviews this week.

Slot selection per `(profileUserId, weekStart)`:
- Deterministic seed `hash(profileUserId + ":" + weekStart)` picks 3 non-event slots: 1 `library` (preferring `forgotten_relic`, falling back to `deep_dive`, else an extra `gamenode`/`weekly` slot if library is empty), 1 `weekly` (rotating `short_caravan` / `weekend_sprint`), and 1 `gamenode` (rotating `captains_log` / `on_duty_critic`).
- Active `published` `guild_event` rows are merged dynamically on every `GET /v1/guild/board` read (not copied into `guild_board_entry`) so publishing or archiving an event takes effect immediately for every user!
- `isRecommended` is computed on the open board list at read time (1st open `library` stale-backlog quest → 1st open `event` → 1st open `weekly`), so if the user accepts the recommended quest, Lina's recommendation cleanly shifts or stays empty without stale flags.

### 4. Local `game_time_to_beat` cache service

`GuildTimeToBeatService.getForGameIds(gameIds: number[])`:
1. Deduplicate `gameIds` and read existing rows from `game_time_to_beat`.
2. Any ID missing or with `fetchedAt < now - 30 days` (bounded to at most 40 game IDs per board-generation call so a huge backlog never bursts IGDB quota) is fetched in a single batched call to `IgdbPlaytimeSyncService.getTimesToBeat(missingIds)`.
3. Upsert returned rows AND negative-cache missing IDs (`hastilySeconds = null, normallySeconds = null, completelySeconds = null, fetchedAt = now`) so games with no IGDB TTB entry are not re-fetched for 30 days.
4. Catch upstream errors/timeouts, log a warning, and return whatever is cached locally — never failing a board or contract read.

`shortcut: board generation inspects at most the 40 most recently added/oldest planned games for TTB cache misses per user; upgrade to a background IGDB TTB catalog sync job if short-game matching needs full-library coverage for 1,000+ game backlogs.`

### 5. Module decoupling and BullMQ `guild-queue`

To avoid circular imports between `GuildModule` and `CollectionsEntriesModule` / `ReviewsModule` / `PlaytimeModule`:

- Create a lightweight `GuildQueueModule` (`src/guild/guild-queue/`) exporting only `GuildQueueService` and registering the BullMQ queue `guild-queue` (mirroring `ActivitiesQueueModule` and `AchievementsQueueService`).
- `CollectionsEntriesService`, `ReviewsService`, and `PlaytimeService` inject `@Optional() private readonly guildQueueService?: GuildQueueService` and call `this.guildQueueService?.enqueueEvaluation(userId, trigger)` after commit (fire-and-forget, deduplicated per `guild-eval-${userId}` with a 2-second TTL matching `ACHIEVEMENTS_TRACKING_DELAY_MS`).
- `GuildContractEvaluatorProcessor` (in `GuildModule`) consumes `guild-queue` jobs:
  1. Checks if the user has any `active` contracts (fast indexed query on `(profileUserId, status)` — instant return for users without active contracts!).
  2. Expires any `active` contract with `expiresAt <= now`.
  3. Evaluates each remaining `active` contract against `collection_entry` (joined with `game_genres_game_genre` / `game_themes_game_theme` / `game_keywords_game_keyword` / `game_time_to_beat` as required by `criteria`) or `review`, strictly filtering `finishedAt >= acceptedAt` or `createdAt >= acceptedAt` (and `< expiresAt` if set).
  4. When `computedProgress >= contract.progressTarget`, opens a transaction, locks the contract row `FOR UPDATE`, verifies `status === 'active'` and `(expiresAt == null || expiresAt > now)`, updates `status = 'ready_to_claim'`, `progressCurrent = progressTarget`, `readyAt = now`, and calls `appendNotificationIntent(manager, { eventType: 'guild.contract-ready', eventVersion: 1, recipientUserId: userId, actorUserId: null, payload: { contractId, category, templateKey, eventId, targetGameId } })`.

### 6. Atomic claim and Achievements integration

`AchievementsProgressService.grantTiers` currently starts its own `this.dataSource.transaction(...)`. Extract its core body into `grantTiersWithManager(manager: EntityManager, userId: string, definition: AchievementDefinition, levels: number[], mode: GrantMode)` (keeping `grantTiers` as a thin wrapper that opens a transaction and publishes the feed activity after commit), and export `AchievementsProgressService` from `AchievementsModule`.

In `GuildContractsService.claim(userId, contractId)`:
1. Transaction:
   - Lock `guild_contract` (`WHERE id = ? AND profileUserId = ? FOR UPDATE`). Not found → 404; `status !== 'ready_to_claim'` → 409.
   - Lock `guild_profile` (`WHERE profileUserId = ? FOR UPDATE`).
   - Resolve attached `guild_reward` (if any):
     - `badge`: call `grantTiersWithManager(manager, userId, definition, [1], "live")` (note: `"live"` returns `null` when already owned without throwing!). Record granted achievement id for post-commit activity registration.
     - `title` / `avatar_frame`: `INSERT IGNORE INTO user_guild_reward`; if `affectedRows === 0`, add `DUPLICATE_COSMETIC_BONUS_XP = 50`.
     - `weekly_chest`: add `reward.chestBonusXp`, query active `inChestPool = 1` rewards not in `user_guild_reward` for `userId`, pick one deterministically/randomly and insert into `user_guild_reward` (or add `DUPLICATE_COSMETIC_BONUS_XP = 50` if pool exhausted).
   - Compute `totalXp = contract.xpReward + bonusXp`.
   - Update `guild_profile.xp += totalXp` and `guild_profile.rank = computeGuildRank(guild_profile.xp)`.
   - Call `this.levelService.increaseExp(userId, totalXp, manager)`.
   - Update `guild_contract`: `status = 'completed'`, `claimedAt = now`, `claimPayload = { xpAwarded: totalXp, rankBefore, rankAfter, unlockedRewards, chestResult }`.
2. After commit: if a badge achievement was newly granted, register its `ACHIEVEMENT_UNLOCKED` feed activity (same post-commit shortcut as `AchievementsProgressService`).

### 7. Notifications integration (`guild.contract-ready`)

Follow the exact existing pattern of `goal.reminder` and `achievement.unlocked`:
- Add `"guild.contract-ready"` to `NotificationEventType` and `SUPPORTED_EVENT_TYPES` in `src/notifications/notifications.types.ts`, with `GuildContractReadyPayload { contractId: string; category: string; templateKey: string | null; eventId: string | null; targetGameId: number | null }` and target `{ type: "guild"; contractId: string }`.
- Validate payload in `notifications-outbox.service.ts`.
- Project in `notifications-projector.service.ts` as an individual item (`subjectType: "guild_contract"`, `subjectId: contractId`, `rootType: "guild"`, `rootId: contractId`, safe preview text + optional game context if `targetGameId` exists).
- Add the `guild` target DTO variant to `src/notifications/dto/notifications-response.dto.ts`.

### 8. Scheduled cleanup & expiration

A lightweight `GuildScheduler` (`@Cron("15 * * * *", { timeZone: DAILY_TIME_ZONE })`) runs an hourly bulk update:
`UPDATE guild_contract SET status = 'expired' WHERE status = 'active' AND expiresAt IS NOT NULL AND expiresAt <= NOW(6)`
plus lazy expiration inside `getOverview`, `getContracts`, and `acceptContract` so users never see stale expired contracts as `active` even between scheduler ticks.

### 9. Supporter early-access rollout gate (`GUILD_ACCESS_MODE`)

To launch the Guild first for Supporters and later open it to all users with a single config flip (no deploy, no migration, no mobile app store release):

- Environment variable `GUILD_ACCESS_MODE` (`"supporters"` | `"public"`, normalized lowercase, defaulting to `"public"` when unset; documented in `.env.example` and forwarded in `docker-compose.yml` / `docker-compose.prod.yml`). Invalid values fail fast at startup or log and default safely (fail fast on invalid non-empty value so a typo never accidentally opens early access!).
- `GuildAccessGuard` (`src/guild/guild-access.guard.ts`) runs after `AuthGuard` on `GuildController`:
  - Handlers decorated with `@BypassGuildAccess()` (only `GET /v1/guild/access`) skip the gate.
  - When `mode === "public"`: returns `true` immediately (**0 billing lookups**).
  - When `mode === "supporters"`: checks `parseRoles(session.user.role)` for `ADMIN` or `EDITOR` first (internal QA bypass with zero DB calls), otherwise calls `BillingService.isSupporter(userId)`. On false, throws `ForbiddenException({ message: "Adventurers Guild is currently in early access for supporters.", code: "guild_early_access_required" })`.
- `GET /v1/guild/access` (`@Public()`, `@BypassGuildAccess()`) returns `{ mode, hasAccess }` using the exact same `GuildAccessService.checkAccess(session)` helper so web and mobile clients render the right entry screen (Early Access CTA vs. Sign-In CTA vs. Guild Hall) without triggering 403 noise.
- `GuildAdminController` (`/v1/guild/admin/**`) does **not** use `GuildAccessGuard` (keeps `@Roles([ADMIN, EDITOR])` only), allowing editors to stage curated events ahead of launch.
- `GuildModule` imports `BillingModule` directly; `BillingModule` has no dependency on `GuildModule`, so no cycle is introduced.
- Alternative rejected: a database feature-flag table or percentage rollout service. Unnecessary complexity for a single `supporters` → `public` toggle.

### 10. Hand-off

The final task writes `openspec/changes/add-adventurers-guild/handoff-clients.md` mapping every Figma frame (`6:2`, `8:268`, `9:387`, `10:409`, `2:62`) to endpoints, DTOs, error codes (including `403 guild_early_access_required`), `GET /v1/guild/access` gating guidance, `templateKey` / `lina.trigger` localization tables (`en` and `pt-BR`), rank title keys, cosmetic key rendering rules (including coexistence with `supporterPreferences`), and the admin curated-event endpoints.

## Risks / Trade-offs

- **[Adding two columns to `profile` increases every serialized `Profile` object slightly]** → Only two nullable short strings (`guildTitleKey`, `guildFrameKey`), zero extra SQL queries on `GET /v1/profile/:id`, verified with a query-count test matching `add-supporter-profile-perks`.
- **[IGDB `game_time_to_beats` rate limits or sparse coverage for indie games]** → Mitigated by local `game_time_to_beat` MySQL cache with 30-day TTL (including negative caching), per-generation batch cap (40 IDs), `IgdbOutboundBudgetService`, and non-TTB fallback template.
- **[InnoDB `AUTO_INCREMENT` on `guild_profile.licenseNumber` may skip numbers on rolled-back or ignored concurrent inserts]** → Acceptable for member license numbers (`Nº 0047` only needs to be unique and monotonically increasing, not gapless).
- **[Queue delay (2s) between finishing a game and contract turning `ready_to_claim`]** → Matches `AchievementsQueueService`; additionally, `POST /v1/guild/contracts/:id/claim` or `GET /v1/guild` can run a fast inline check for the user's at-most-3 `active` contracts if an immediate UI refresh right after finishing a game is desired (we will keep async queue as primary for notifications AND run a fast on-demand sync on `GET /v1/guild` when the user has `active` contracts — bounded to at most 3 contracts so latency stays negligible and the player never stares at stale progress!).
- **[Badge reward `AchievementDefinition` expReward double-counting]** → Starter Guild badge achievements use `expReward: 0` because the Guild contract already grants `xpReward` to both Guild XP and `UserLevel`; documented in admin reward validation/guidance.

## Migration Plan

1. Deploy `1795900000000-AddAdventurersGuild` together with the application release (all new tables + two nullable columns on `profile` + starter reward/achievement seeds).
2. No backfill is required: `guild_profile` and weekly boards initialize lazily on each user's first visit.
3. Rollback: revert application code; the new tables and nullable `profile` columns are ignored by older code, or run migration `down` to drop them cleanly.

## Open Questions

- Exact starter chest cosmetic key names (`frame_parchment_seal`, `frame_lantern_glow`, etc.) and any additional curated event themes can be coordinated with the frontend asset pack during the client change without altering API contracts.
