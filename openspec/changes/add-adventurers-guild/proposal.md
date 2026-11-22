# Proposal

## Why

The Adventurers Guild design ("GameNode — Guilda de Missões (NPC Recepcionista)", Figma `rvZfYT3eR8ktZAW6g3HO8C`, page `0:1`) introduces a quest hub hosted by receptionist NPC Lina: a weekly personalized quest board refreshed every Monday, active contracts with live progress (including hours played against average time-to-beat and the user's yearly goal), a Guild License with rank progression (`E` through `S`), contextual Lina dialogue triggers, curated seasonal/editorial events (e.g. "Mês do Metroidvania"), and rewards (XP, badges, profile frames, titles, and weekly chests). Today the server has individual pieces — `UserLevel`, `AchievementDefinition`, `CollectionEntry`, `Review`, `UserPlaytime`, `YearGoal`, and on-demand IGDB `TimeToBeatService` — but no Guild domain, quest board generator, contract lifecycle, local TTB cache, cosmetic inventory, or curated event management, so the frontend cannot build any of these screens.

## What Changes

- **Guild Profile, License, Early-Access Gate & Lina Reception**:
  - Introduce a configurable rollout gate (`GUILD_ACCESS_MODE=supporters | public`, defaulting to `public` when unset) enforced by `GuildAccessGuard` on player `/v1/guild/**` endpoints so supporters (plus `ADMIN`/`EDITOR` roles for internal verification) get early access first and general availability flips via configuration with no code deploy or migration. Blocked users receive `403` (`code: "guild_early_access_required"`) without creating a `guild_profile`; lapsed supporters retain all Guild data and equipped cosmetics.
  - Expose a lightweight `@Public()` `GET /v1/guild/access` endpoint returning `{ mode, hasAccess }` so web and mobile clients adapt immediately when `GUILD_ACCESS_MODE` flips without requiring app store releases.
  - Introduce a lazily initialized `guild_profile` per user with a sequential Guild License number (`licenseNumber`, e.g. `Nº 0047`), Guild XP, Guild Rank ladder (`E` → `D` → `C` → `B` → `A` → `S`), next-rank threshold, and last-seen board timestamp.
  - Expose `GET /v1/guild` returning the user's Guild License (rank, XP, next-rank XP, license number, member-since date, finished/backlog/reviews counts, equipped title/frame), active contracts (plus the user's existing `YearGoal` for the current year), current board counts (`board`, `accepted`, `completed`), next Monday refresh timestamp, and Lina's structured reception state (`trigger`, `pose`, `context`, `hasUnseenBoard`).
  - Expose `POST /v1/guild/board/seen` to acknowledge the current board and clear Lina's `!` alert indicator.
- **Weekly Personalized Quest Board & Time-to-Beat Cache**:
  - Refresh each user's personalized board every Monday at 00:00 `America/Sao_Paulo` (matching `DAILY_TIME_ZONE`), deterministically persisted per `(profileUserId, weekStart)` so reloads within the same week stay stable.
  - Support four board quest categories (`library`, `event`, `weekly`, `gamenode`) with difficulty ranks (`E`–`S`), candidate game chips, and one `isRecommended` pick (`★ Lina recomenda`).
  - Add a local `game_time_to_beat` cache table lazily populated in batches from the existing `IgdbPlaytimeSyncService` so short-game weekly quests (e.g. `< 8h` average duration) and active contract playtime progress (`18h / 29h`, `62%`) do not hammer IGDB on reads.
  - Expose `GET /v1/guild/board` (with optional `?quick=true` filter supporting Lina's `"Tem algum pedido mais rápido?"` dialogue choice).
- **Two-Stage Contract Lifecycle (`active` → `ready_to_claim` → `completed`)**:
  - Expose `POST /v1/guild/contracts` to accept a board quest (binding an optional/required `targetGameId` when targeting a specific backlog/candidate game), enforcing a cap of 3 active contracts per user and preventing duplicate active contracts for the same quest instance.
  - Track contract progress asynchronously through a dedicated BullMQ `guild-queue` triggered by committed library (`CollectionsEntriesService`), review (`ReviewsService`), and playtime (`PlaytimeService`) mutations, plus live playtime/TTB ratio enrichment on read. Only qualifying actions performed after `acceptedAt` count toward contract completion.
  - Transition fulfilled contracts atomically to `ready_to_claim` and enqueue a `guild.contract-ready` notification intent in the existing transactional outbox so the player knows to return to Lina's counter.
  - Expose `POST /v1/guild/contracts/:id/claim` (Lina's counter turn-in): atomically stamps the contract `completed`, credits Guild XP (updating Rank) and global `UserLevel` XP via `LevelService.increaseExp`, grants any linked reward, and returns the stamped receipt and celebration trigger.
  - Expose `POST /v1/guild/contracts/:id/abandon` for `active` contracts and `GET /v1/guild/contracts` (filterable by status) for the "Aceitos" and "Concluídos" views. Expire overdue unfulfilled contracts automatically when their deadline passes.
- **Guild Rewards & Profile Cosmetics**:
  - Add `guild_reward` and `user_guild_reward` tables supporting four reward kinds: `badge` (linked to a published `AchievementDefinition` and granted idempotently via `AchievementsProgressService.grantTiers`), `title`, `avatar_frame`, and `weekly_chest` (grants bonus Guild + global XP and an unowned pool cosmetic when available, returning the opened contents on claim).
  - Add nullable `guildTitleKey` and `guildFrameKey` columns directly on `profile` (updated only through `PATCH /v1/guild/cosmetics` after verifying ownership in `user_guild_reward`) and expose them on `ProfileResponseDto` with zero extra SQL queries on `GET /v1/profile` and `GET /v1/profile/:id`, coexisting non-destructively with `supporterPreferences`.
  - Expose `GET /v1/guild/rewards` to list unlocked Guild cosmetics and equipped state.
- **Curated Events & Admin Management**:
  - Add `@Roles([EUserRoles.ADMIN, EUserRoles.EDITOR])` CRUD and lifecycle endpoints under `/v1/guild/admin/events` (`draft` → `published` → `archived`) and `/v1/guild/admin/rewards` with date windows, validated objective criteria (`gameIds`, `genreIds`, `themeIds`, `keywordIds`, `maxTimeToBeatHours`, `targetCount`), linked rewards, and per-locale `translations` (`en`, `pt-BR`) matching the `awards` translation contract.
- **Notifications & Hand-off**:
  - Add `guild.contract-ready` to the existing notification outbox/projector pipeline as an individual inbox item targeting `{ type: "guild", contractId }`.
  - Generate `handoff-clients.md` as the final task for the separate web/mobile frontend change.

Not included: client UI, pixel-art sprites or keyframe animations, localized system-quest copy strings (clients render from stable template/trigger keys + params), free-text custom titles, multiplayer/clan guilds, leaderboards, or user-authored custom quests beyond the existing `YearGoal`.

## Capabilities

### New Capabilities

- `guild-profile-and-ranks`: Supporter early-access rollout gate (`GUILD_ACCESS_MODE` and `GET /v1/guild/access`), per-user Guild membership, sequential license number, Guild XP and Rank ladder (`E`–`S`), License stats, `YearGoal` summary integration, and Lina's contextual reception/dialogue triggers with unseen-board state.
- `guild-quest-board`: Weekly Monday-refreshed personalized quest board (`library`, `event`, `weekly`, `gamenode`), local `game_time_to_beat` caching, candidate game chips, Lina's recommendation, and quick-quest filtering.
- `guild-contracts`: Contract acceptance, active slot limits, asynchronous progress evaluation from library/review/playtime events, two-stage completion (`active` → `ready_to_claim` → `completed`) with atomic turn-in, abandonment, and expiration.
- `guild-rewards-and-cosmetics`: Guild reward catalog (`badge`, `title`, `avatar_frame`, `weekly_chest`), permanent unlock inventory, chest opening, equipping titles and avatar frames, and zero-extra-query exposure on profile reads.
- `guild-curated-events`: Admin/editor management of curated Guild events and cosmetic rewards, including lifecycle transitions, criteria validation, and `en`/`pt-BR` translations.

### Modified Capabilities

- `notification-delivery`: Adds the `guild.contract-ready` system notification intent committed atomically when an accepted Guild contract becomes ready to claim, materialized as an individual inbox item targeting `{ type: "guild", contractId }`.

## Impact

- **API**: New endpoints under `/v1/guild` (`GET /v1/guild/access` public discovery, plus guarded `GET /v1/guild`, `GET /v1/guild/board`, `POST /v1/guild/board/seen`, `GET /v1/guild/contracts`, `POST /v1/guild/contracts`, `POST /v1/guild/contracts/:id/claim`, `POST /v1/guild/contracts/:id/abandon`, `GET /v1/guild/rewards`, `PATCH /v1/guild/cosmetics`) and admin/editor endpoints under `/v1/guild/admin/events` and `/v1/guild/admin/rewards`. Additive nullable `guildTitleKey` and `guildFrameKey` fields on `GET /v1/profile` and `GET /v1/profile/:id`. Additive `guild` notification target variant on `GET /v1/notifications`.
- **Code**: New `src/guild/**` module (entities, DTOs, `GuildAccessGuard`, board generator, contract evaluator/queue processor, TTB cache service, rewards/cosmetics service, Lina reception service, admin service, scheduler, controllers, importing `BillingModule` for supporter entitlement); `.env.example` / `docker-compose*.yml` (`GUILD_ACCESS_MODE`); lightweight BullMQ enqueue hooks in `src/collections/collections-entries/collections-entries.service.ts`, `src/reviews/reviews.service.ts`, and `src/playtime/playtime.service.ts`; additive columns on `src/profile/entities/profile.entity.ts` and `src/profile/dto/profile-response.dto.ts`; `guild.contract-ready` support in `src/notifications/**`; export `AchievementsProgressService` from `src/achievements/achievements.module.ts`.
- **Database**: One MySQL migration adding `guild_profile`, `guild_reward`, `user_guild_reward`, `guild_event`, `guild_event_translation`, `guild_board_entry`, `guild_contract`, and `game_time_to_beat`, plus nullable `guildTitleKey` and `guildFrameKey` columns on `profile`, and seeding the starter system reward catalog.
- **External services**: Batched, locally cached calls to IGDB `game_time_to_beats` via existing `IgdbPlaytimeSyncService` and `IgdbOutboundBudgetService`, only for uncached or stale game IDs during board generation or active contract reads.
- **Clients**: Strictly additive. Web and mobile implement the Guild screens, Lina animations, and cosmetic rendering in a separate change using `handoff-clients.md`.
