# Proposal

## Why

The initial Adventurers Guild implementation (`add-adventurers-guild`) established a solid, race-safe foundation (deterministic weekly board, append-only `collection_entry_status_history`, local TTB cache, transactional notifications, and Lina's reception), but its quest and reward loops currently saturate too quickly:

1. **Shallow automatic quest variety**: only 8 system templates exist across just 2 objectives (`finish_game`, `write_review`), repeating within 3 weeks and leaving zero automatic Rank `A` or `S` quests.
2. **Untapped platform signals**: `PlaytimeService` already enqueues `"playtime"` evaluation jobs that the evaluator never consumes, while IGDB game metadata (`firstReleaseDate`, `franchises`, `platforms`, `category`/DLCs/remakes, long TTB), GameNode Daily, Posts, Collections, and synced platform achievements/platinums are completely unused. New accounts (< 1 year old) never see `forgotten_relic` or earn `badge_archaeologist`.
3. **Distorted XP economy & fast-exhausting rewards**: repeating a `badge` quest grants 0 duplicate bonus (making `forgotten_relic` pay less than `deep_dive`), short reviews pay nearly as much as finishing a game, all ranks open the same `weekly_chest`, the 10-item chest pool runs dry in 4–5 weeks, and ranking up (`E` → `S`) grants no rewards or functional progression.

This change expands the Adventurers Guild into a deep, long-lived progression loop with diverse personalized missions, rank-scaled cadence, cooperative community bounties, narrative quest chains, and a sustainable multi-tier reward economy anchored on Guild Seals and Lina's Emporium.

## What Changes

- **Expanded Objective Types & Platform Hooks**:
  - Add 8 new `GuildObjectiveType` values alongside `finish_game` and `write_review`: `log_playtime` (activating the already-wired `PlaytimeService` hook via `PlaytimeHistoryService`), `play_distinct_days`, `daily_challenge` (GameNode Daily wins/no-hint/low-attempt streaks), `earn_game_achievements`, `complete_game_100` (synced Steam/PSN/Xbox achievements & platinums via `ObtainedGameAchievement` / `GameCompletionStatus`), `curate_collection`, `publish_post`, and `triage_backlog` (deliberate status transitions out of stale `planned` backlog).
  - Add lightweight, cycle-free `GuildQueueService` enqueue hooks in `DailyService`, `PostsService`, `CollectionsService`, and `GameObtainedAchievementService` (mirroring the existing hooks in `CollectionsEntriesService`, `ReviewsService`, and `PlaytimeService`).
  - Enforce explicit anti-spam and anti-abuse rules per objective (minimum content lengths, minimum playtime thresholds, distinct-game/distinct-day counting, first-time completion semantics, and non-farmable collection/triage rules).
- **Rich IGDB Criteria, Procedural Templates & Background TTB Coverage**:
  - Extend `GuildCriteria` with `minTimeToBeatHours`, `releaseYearMin`, `releaseYearMax`, `franchiseIds`, `platformIds`, `gameCategories`, `indieOnly`, `minReviewChars`, `minPlaytimeSecondsPerGame`, `minPostChars`, `minCollectionEntries`, `requireNoDailyHint`, and `maxDailyAttempts` (supported across both automatic templates and admin curated events).
  - Expand the automatic template catalog from 8 to 20 templates spanning Ranks `E`–`S`, including tiered backlog relics (`recent_dust` ≥ 90d, `forgotten_relic` ≥ 365d, `ancient_fossil` ≥ 1,095d), playtime taste-tests (`backlog_taste_test`), Daily oracle quests, synced achievement/platinum quests, and procedural personalized templates generated from each user's library DNA: *Off the Map* (`off_the_map`, genre inversion), *Continue the Saga* (`continue_the_saga`, unfinished franchise entry), *Time Machine* (`time_machine`, decade challenge), *The Colossus* (`the_colossus`, ≥ 35h epic), *Hidden Gem* (`hidden_gem`, low-popularity backlog pick), and *Return to the World* (`return_to_the_world`, DLC/expansion/remake of a finished game).
  - Add a bounded background TTB prefetch sweep in `GuildScheduler` for active Guild members' libraries to remove the 40-game cold-start blind spot for short and long-form quests.
- **Board Cadence, Rerolls, Monthly Expeditions & Optional Bonus Objectives**:
  - Add a **Monthly Expedition** board slot (4th automatic slot, refreshed on the 1st of each `America/Sao_Paulo` month, unlocked at Rank `C`) offering Rank `A` and `S` long-form contracts (30–60 day deadlines) scaled to the user's rank.
  - Add conversational **Board Reroll** (`POST /v1/guild/board/:entryId/reroll`) allowing deterministic replacement of an open weekly slot using free rank-granted weekly rerolls (1/week at Rank `D`, 2/week at Rank `S`) or a `reroll_charter` consumable.
  - Add optional **Bonus Objectives** (`bonusObjective`) on contracts (e.g., also write a 150+ char review, finish within half the deadline, or pick a 6+ month backlog game) that award bonus Guild XP, extra Seals, or a one-tier chest upgrade on claim without blocking base completion.
- **Narrative Quest Chains (Lina's Arcs)**:
  - Introduce multi-stage sequential quest chains (`guild_quest_chain` / `guild_user_chain_progress`) where completing and claiming stage `N` unlocks stage `N+1` (e.g., *Pathfinder's Arc*: play 2h → finish that game → review it; *Curator's Arc*: curate collection → finish 1 game from it → publish a recommendation post; *Relic Hunter's Arc*).
  - Each stage awards partial XP + Seals; completing the final stage grants an arc-exclusive cosmetic and triggers a dedicated Lina celebration.
- **Cooperative Community Bounties**:
  - Introduce server-wide cooperative campaigns (`guild_community_bounty` + translations + `guild_community_bounty_contribution` + claims) managed by `ADMIN`/`EDITOR` under `/v1/guild/admin/bounties`.
  - Aggregate qualifying actions across all participating Guild members toward shared milestones (25%, 50%, 100%, and 150% overkill). Any member who contributes at least the minimum qualifying action while active can claim the milestone rewards once unlocked, with a `guild.community-bounty-ready` notification at 100%.
- **Rebalanced Economy, Guild Seals, Tiered Chests, Emporium & Consumables**:
  - Rebalance XP rewards across ranks (`E`: 60–100, `D`: 120–180, `C`: 220–320, `B`: 360–500, `A`: 650–900, `S`: 1,200–1,500) and fix the duplicate `badge` anomaly so already-owned badges grant duplicate fallback XP + Seals.
  - Introduce **Guild Seals** (`sealsBalance` on `guild_profile` + append-only `guild_seal_ledger`) earned from every claimed contract, bonus objective, passport stamp, and duplicate conversion.
  - Replace the flat `weekly_chest` progression with **4 Chest Tiers** (`chest_bronze`, `chest_silver`, `chest_gold`, `chest_relic`, keeping `weekly_chest` active for backwards compatibility as a Silver-equivalent legacy key) with tier-appropriate cosmetic pools (`rarity`: `common` | `uncommon` | `rare` | `epic` | `legendary`) and Seals conversion when a tier's pool is exhausted.
  - Add **Lina's Emporium** (`GET /v1/guild/emporium`, `POST /v1/guild/emporium/purchase`) with a rank-gated permanent catalog and a deterministic monthly rotating showcase of seasonal cosmetics, plus 3 Guild utility consumables (`hourglass` +7d deadline extension via `POST /v1/guild/contracts/:id/extend`, `reroll_charter` extra weekly reroll, `extra_slot_permit` temporary +1 active contract slot for the current week).
- **Rank Promotion Packages, Prestige `S+`, Monthly Passport & New Cosmetics**:
  - Grant automatic **Rank Promotion Packages** on reaching Ranks `D`, `C`, `B`, `A`, and `S` (exclusive rank cosmetics + functional perks: Rank `D` 1 free weekly reroll, Rank `C` Monthly Expedition slot, Rank `B` active contract cap `3 → 4`, Rank `A` Rank `S` quests + 1 free monthly Hourglass, Rank `S` 2 weekly rerolls + Legendary quests).
  - Add **Prestige `S+`** (`prestigeLevel` incremented every 2,500 Guild XP above 7,500 XP), awarding a `chest_relic` per prestige star so Rank `S` remains rewarding indefinitely.
  - Add the **Monthly Guild Passport** (`GET /v1/guild/passport`, `POST /v1/guild/passport/claim/:milestone`) tracking completed contracts per São Paulo month with claimable milestone rewards at 2, 4, and 6 contracts (healthy consistency without punishing weekly streaks).
  - Expand equippable Guild cosmetics with `license_theme`, `stamp_style`, `tavern_decor` (Lina's counter decorations, up to 4 active slots), and a 3-slot **Trophy Showcase** (`showcaseBadgeIds`) on the Guild License (stored on `guild_profile`, keeping `GET /v1/profile/:id` at **zero extra SQL queries**).
- **Notifications & Client Hand-off**:
  - Add `guild.community-bounty-ready` to the transactional notification outbox/projector pipeline.
  - Produce an updated `handoff-clients.md` documenting all new endpoints, DTOs, localization keys, cosmetic asset keys, and backwards-compatibility guarantees.

Not included: frontend UI or pixel-art/sprite assets (separate `game-node-clients` change), real-money monetization of Seals/consumables (strictly earned via gameplay), player-to-player trading, competitive PvP leaderboards, or clan/party chat.

## Capabilities

### New Capabilities

> Note: The foundational `add-adventurers-guild` change is implemented (`22/22` tasks) but not yet archived into `openspec/specs/`. Where this change extends those five foundational Guild capabilities (`guild-quest-board`, `guild-contracts`, `guild-profile-and-ranks`, `guild-rewards-and-cosmetics`, `guild-curated-events`), their delta specs are included here as additive requirements alongside four brand-new Guild capabilities.

- `guild-quest-board`: Expanded automatic template catalog (20 templates across `E`–`S`), procedural library-DNA quest generation, extended IGDB criteria, background TTB prefetch, rank-gated board scaling, and deterministic weekly slot rerolls.
- `guild-contracts`: Eight new `GuildObjectiveType` evaluators with anti-spam safeguards, dynamic active contract cap (3 → 4 at Rank `B` + permit), optional contract bonus objectives, and Hourglass deadline extension.
- `guild-profile-and-ranks`: Rank promotion reward packages (`D`–`S`), rank-unlocked functional perks, Prestige `S+` endless progression, Guild License customization (`license_theme`, `stamp_style`, `tavern_decor`, 3-slot Trophy Showcase), and new Lina reception/celebration triggers.
- `guild-rewards-and-cosmetics`: Rebalanced XP economy, duplicate badge fallback fix, 4-tier chests with rarity pools and Seals fallback, and expanded equippable cosmetic kinds without adding SQL queries to `GET /v1/profile/:id`.
- `guild-curated-events`: Support for all new `GuildObjectiveType` values, extended `GuildCriteria` keys, tiered chests/new cosmetic kinds, and optional bonus objectives in `/v1/guild/admin/events` and `/v1/guild/admin/rewards`.
- `guild-emporium-and-economy`: Guild Seals currency and append-only ledger, Lina's Emporium (rank-gated permanent catalog + monthly rotating showcase), atomic purchase flow, and Guild utility consumables (`hourglass`, `reroll_charter`, `extra_slot_permit`).
- `guild-monthly-expeditions-and-passport`: Rank-unlocked Monthly Expedition board slot (Rank `A`/`S` long-form quests) and the Monthly Guild Passport stamp track (2 / 4 / 6 completed contracts per São Paulo month).
- `guild-quest-chains`: Multi-stage narrative contract arcs with sequential unlocking, per-stage progress/rewards, and arc completion cosmetics.
- `guild-community-bounties`: Cooperative server-wide bounty campaigns, admin CRUD/lifecycle, anti-spam contribution aggregation, shared milestones (25% / 50% / 100% / 150%), and contributor reward claiming.

### Modified Capabilities

- `notification-delivery`: Adds the `guild.community-bounty-ready` system notification intent committed when a community bounty reaches its 100% goal for participating contributors, materialized as an individual inbox item targeting `{ type: "guild", bountyId }`.

## Impact

- **API**: Strictly additive changes under `/v1/guild` and `/v1/guild/admin`:
  - New player endpoints: `POST /v1/guild/board/:entryId/reroll`, `POST /v1/guild/contracts/:id/extend`, `GET /v1/guild/emporium`, `POST /v1/guild/emporium/purchase`, `POST /v1/guild/consumables/:key/activate`, `GET /v1/guild/passport`, `POST /v1/guild/passport/claim/:milestone`, `GET /v1/guild/chains`, `POST /v1/guild/chains/:chainKey/start`, `GET /v1/guild/bounties`, `POST /v1/guild/bounties/:id/claim`.
  - New admin endpoints (`ADMIN`/`EDITOR`): `/v1/guild/admin/bounties` (CRUD + publish/archive) and `/v1/guild/admin/emporium` (manage Emporium items/pricing/rotation).
  - Additive fields on existing `GET /v1/guild`, `GET /v1/guild/board`, `GET /v1/guild/contracts`, `POST /v1/guild/contracts/:id/claim`, `GET /v1/guild/rewards`, and `PATCH /v1/guild/cosmetics` responses. Existing `ProfileResponseDto` (`guildTitleKey`, `guildFrameKey`) and zero-extra-query profile read invariant remain untouched.
- **Code**:
  - Extensions in `src/guild/**` (new evaluators, procedural template generator, Emporium/Seals service, Passport service, Quest Chains service, Community Bounties service, background TTB prefetch in `GuildScheduler`, expanded DTOs and admin controllers).
  - Lightweight `@Optional()` `GuildQueueService` enqueue hooks in `src/daily/daily.service.ts`, `src/posts/posts.service.ts`, `src/collections/collections.service.ts`, and `src/game/game-achievement/game-obtained-achievement.service.ts`.
  - Additive notification variant `guild.community-bounty-ready` in `src/notifications/**`.
- **Database**: One additive MySQL migration (`1796100000000-ExpandAdventurersGuild.ts`) adding columns to `guild_profile`, `guild_reward`, `guild_board_entry`, `guild_contract`, and `guild_event`; creating `guild_seal_ledger`, `guild_consumable_inventory`, `guild_emporium_item`, `guild_passport_month`, `guild_user_chain`, `guild_community_bounty`, `guild_community_bounty_translation`, `guild_community_bounty_contribution`, and `guild_community_bounty_claim`; and seeding the tiered chests, rank promotion rewards, initial Emporium catalog, and starter quest chain cosmetics.
- **Clients**: Strictly additive and backwards-compatible with `add-adventurers-guild` clients. Full client contract delivered in `handoff-clients.md`.
