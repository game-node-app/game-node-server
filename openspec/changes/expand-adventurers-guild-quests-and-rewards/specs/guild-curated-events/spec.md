# Spec Delta

## Purpose

Extends admin/editor curated event and reward management to support all new Guild objective types, extended IGDB criteria, optional bonus objectives, tiered chests, new cosmetic kinds, and Guild Seals rewards.

## ADDED Requirements

### Requirement: Curated events support all new objectives, criteria, and bonus objectives
`POST /v1/guild/admin/events` and `PATCH /v1/guild/admin/events/:id` SHALL accept all 10 `GuildObjectiveType` values, extended `GuildCriteria` keys valid for the chosen objective, optional `sealsReward` (defaulting by `rank`), and optional `bonusObjective`, rejecting invalid combinations with 400. Once any contract is accepted for the event, `sealsReward` and `bonusObjective` SHALL also lock under `409 guild_event_rules_locked`.

#### Scenario: Editor creates a decade-scoped RPG playtime event with a bonus objective
- **WHEN** an editor posts an event with `objectiveType: "log_playtime"`, `targetCount: 300`, `criteria: { genreIds: [12], releaseYearMin: 1990, releaseYearMax: 1999 }`, `sealsReward: 80`, and `bonusObjective: { type: "also_write_review", minChars: 150, bonusSeals: 30 }`
- **THEN** the event is created in `draft` status with those rules stored

#### Scenario: Unsupported criteria key for objective is rejected
- **WHEN** an editor posts an event with `objectiveType: "daily_challenge"` and `criteria: { minTimeToBeatHours: 40 }`
- **THEN** the request fails with 400

### Requirement: Admin reward catalog supports expanded kinds, rarities, and tiered chests
`POST /v1/guild/admin/rewards` and `PATCH /v1/guild/admin/rewards/:id` SHALL support all expanded `GuildRewardKind` values, `rarity`, `chestBonusSeals`, and `consumableKey` (required when `kind === "consumable"`). `inChestPool: true` SHALL be valid only for permanent equippable cosmetic kinds (`title`, `avatar_frame`, `license_theme`, `stamp_style`, `tavern_decor`), returning 400 otherwise.

#### Scenario: Editor creates a seasonal tavern decor cosmetic
- **WHEN** an editor posts `{ key: "decor_autumn_lantern", kind: "tavern_decor", rarity: "epic", inChestPool: false }`
- **THEN** the reward is persisted and can be attached to an event or Emporium listing

#### Scenario: Setting inChestPool on a consumable reward is rejected
- **WHEN** an editor posts a `consumable` reward with `inChestPool: true`
- **THEN** the request fails with 400
