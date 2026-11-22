# Spec Delta

## Purpose

Manages the Guild reward catalog (`badge`, `title`, `avatar_frame`, `weekly_chest`), permanent user unlock inventory, weekly chest opening, equipping titles and avatar frames, and zero-extra-query exposure on profile reads.

## ADDED Requirements

### Requirement: Guild reward catalog kinds
The system SHALL maintain a `guild_reward` catalog supporting four kinds: `badge` (linked to a published `AchievementDefinition`), `title` (keyed profile/license title), `avatar_frame` (keyed avatar frame), and `weekly_chest` (bonus XP plus an unowned chest-pool cosmetic when available).

#### Scenario: Starter reward catalog exists after migration
- **WHEN** the Guild migration runs on a fresh or existing database
- **THEN** starter `weekly_chest`, `title`, `avatar_frame`, and `badge` rewards are available for system quest templates and chest pools

### Requirement: Idempotent badge granting through platform achievements
When a claimed contract carries a `badge` reward linked to a published `AchievementDefinition`, the system SHALL grant tier 1 of that achievement within the claim transaction via the platform achievement progression path. If the user already owns tier 1, the claim SHALL still succeed and award contract XP without duplicating the achievement or failing.

#### Scenario: First-time badge reward grants achievement
- **WHEN** a user claims `Relíquia Esquecida` with linked badge `badge_archaeologist` for the first time
- **THEN** tier 1 of the linked `AchievementDefinition` is granted in the same transaction and reported in `unlockedRewards`

#### Scenario: Re-earning a quest whose badge is already owned still succeeds
- **WHEN** a user who already owns the linked achievement claims another contract offering that same `badge` reward
- **THEN** the claim succeeds, grants the contract's XP, and does not throw or duplicate the achievement

### Requirement: Permanent cosmetic unlock inventory and duplicate fallback
Claiming a contract that unlocks a `title` or `avatar_frame` SHALL permanently record `(profileUserId, rewardId)` in `user_guild_reward`. If the user already owns that cosmetic, the claim SHALL stay idempotent and award +50 Guild XP (converted to global `UserLevel` XP with the claim's 0.25 multiplier) instead of failing. `GET /v1/guild/rewards` SHALL return all unlocked Guild cosmetics and the user's equipped `guildTitleKey` and `guildFrameKey`.

#### Scenario: Unlocking a new title records ownership permanently
- **WHEN** a user claims `Diário de Bordo` offering `title_chronist`
- **THEN** `title_chronist` is persisted in `user_guild_reward` and appears in `GET /v1/guild/rewards`

#### Scenario: Re-unlocking an already-owned title grants fallback XP
- **WHEN** a user who already owns `title_chronist` claims a contract offering `title_chronist`
- **THEN** no duplicate inventory row is created and the claim awards an extra 50 Guild XP (included in the global XP conversion)

### Requirement: Weekly chest opening on claim
Claiming a `weekly_chest` contract SHALL open the chest atomically inside the claim transaction, crediting `chestBonusXp` as Guild XP (converted to global XP with the claim multiplier) and permanently unlocking one unowned active `inChestPool` cosmetic if any remain (otherwise crediting an extra +50 Guild XP). The opened `chestResult: { bonusXp, unlockedCosmetic }` SHALL be persisted on `claimPayload` and returned.

#### Scenario: Weekly chest awards bonus XP and an unowned pool cosmetic
- **WHEN** a user claims `Caravana Curta` carrying `weekly_chest` while unowned pool cosmetics remain
- **THEN** the user receives `xpReward + chestBonusXp` and permanently unlocks one unowned pool cosmetic reported in `chestResult`

#### Scenario: Weekly chest when pool is exhausted grants extra bonus XP
- **WHEN** a user who already owns all active chest-pool cosmetics claims a `weekly_chest` contract
- **THEN** `chestResult.unlockedCosmetic` is `null` and `chestResult.bonusXp` includes the extra fallback XP bonus

### Requirement: Varied chest cosmetic picks
The chest cosmetic SHALL be chosen pseudo-randomly per user and contract among unowned active pool cosmetics, so different users do not unlock the pool in the same order. The starter chest pool SHALL contain at least ten cosmetics.

#### Scenario: Two users get different first chest cosmetics
- **WHEN** many users open their first weekly chest
- **THEN** the unlocked cosmetics are spread across the pool instead of always being the same one

### Requirement: Equipping Guild titles and avatar frames
`PATCH /v1/guild/cosmetics` SHALL allow the authenticated user to update `guildTitleKey` and/or `guildFrameKey` independently (omitted fields stay unchanged; `null` unequips). Setting a non-null key SHALL succeed only when the user owns an unlocked reward of the matching kind (`title` or `avatar_frame`); otherwise the request SHALL fail with 403 (`code: "guild_cosmetic_not_owned"`) without mutating state.

#### Scenario: Equipping an owned title and frame
- **WHEN** a user who owns `title_chronist` and `frame_lantern_glow` calls `PATCH /v1/guild/cosmetics` with `{ guildTitleKey: "title_chronist", guildFrameKey: "frame_lantern_glow" }`
- **THEN** both values are saved on the user's profile and returned in the response

#### Scenario: Equipping an unowned or wrong-kind cosmetic is rejected
- **WHEN** a user calls `PATCH /v1/guild/cosmetics` with `{ guildTitleKey: "frame_lantern_glow" }` or a key they have not unlocked
- **THEN** the request fails with 403 and leaves the user's equipped cosmetics unchanged

#### Scenario: Unequipping clears only the specified slot
- **WHEN** a user with both title and frame equipped calls `PATCH /v1/guild/cosmetics` with `{ guildFrameKey: null }`
- **THEN** `guildFrameKey` becomes `null` while `guildTitleKey` remains unchanged

### Requirement: Zero-extra-query exposure on profile reads and supporter coexistence
`GET /v1/profile` and `GET /v1/profile/:id` SHALL expose nullable `guildTitleKey` and `guildFrameKey` on `ProfileResponseDto` without adding any extra SQL queries to profile reads. Guild cosmetics SHALL remain independent of supporter entitlement: equipping or clearing them SHALL NOT mutate `supporterPreferences`, and losing supporter status SHALL NOT remove unlocked or equipped Guild cosmetics.

#### Scenario: Public profile read exposes equipped Guild cosmetics with unchanged query count
- **WHEN** any viewer requests `GET /v1/profile/:id` for a user who equipped `guildTitleKey` and `guildFrameKey`
- **THEN** the response includes both keys alongside existing fields without executing additional SQL statements beyond the existing profile read

#### Scenario: Supporter lapse preserves Guild cosmetics
- **WHEN** a former supporter's subscription expires
- **THEN** `supporterPreferences` becomes `null` while `guildTitleKey` and `guildFrameKey` remain intact
