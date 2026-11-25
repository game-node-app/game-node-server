# Spec Delta

## Purpose

Rebalances the Guild XP and Seals economy, fixes duplicate badge fallbacks, introduces 4-tier chests with rarity pools and Seals conversion, and expands the reward catalog with license themes, stamps, tavern decor, and consumables.

## ADDED Requirements

### Requirement: Expanded reward kinds and rarity tiers
`guild_reward` SHALL support `badge`, `title`, `avatar_frame`, `license_theme`, `stamp_style`, `tavern_decor`, `consumable`, `weekly_chest` (legacy Silver-equivalent), `chest_bronze`, `chest_silver`, `chest_gold`, and `chest_relic`. Every reward SHALL store `rarity` (`common` | `uncommon` | `rare` | `epic` | `legendary`), optional `chestBonusSeals`, and optional `consumableKey`.

#### Scenario: Expanded starter catalog is seeded idempotently
- **WHEN** the expansion migration runs
- **THEN** all four tiered chests, rank promotion rewards, at least 25 tiered chest-pool cosmetics across rarities, license themes, stamp styles, tavern decor items, and consumables exist in `guild_reward`

### Requirement: Rebalanced Guild XP and Seals economy
Contract XP and Guild Seals SHALL scale proportionally with effort and rank (`E`: 60–100 XP / 10 Seals; `D`: 120–180 XP / 20 Seals; `C`: 220–320 XP / 35 Seals; `B`: 360–500 XP / 60 Seals; `A`: 650–900 XP / 110 Seals; `S`: 1,200–1,500 XP / 200 Seals). Low-effort quick review templates SHALL award Bronze chests or pure XP+Seals rather than Silver chests.

#### Scenario: High-effort backlog quests pay more than quick reviews
- **WHEN** a user compares `forgotten_relic` (Rank `B`) against `quick_take` (Rank `E`)
- **THEN** `forgotten_relic` awards 420 base XP and 60 Seals while `quick_take` awards 70 base XP, 10 Seals, and no chest

### Requirement: Duplicate badge fallback compensation
When a claimed contract carries a `badge` reward whose linked `AchievementDefinition` tier 1 is already owned by the user, the claim SHALL succeed idempotently and credit duplicate fallback compensation (`+50` Guild XP and `+25` Guild Seals) so repeating badge quests never pays less than lower-rank chest quests.

#### Scenario: Repeating forgotten_relic with badge already owned grants XP and Seals fallback
- **WHEN** a user who already owns `guild-archaeologist` claims a second `forgotten_relic` contract
- **THEN** no duplicate achievement is created, `unlockedRewards` omits `badge_archaeologist`, and the claim credits `+50` bonus Guild XP and `+25` bonus Guild Seals

### Requirement: Four-tier chest opening with rarity pools and Seals fallback
Opening a tiered chest (`chest_bronze`, `chest_silver`/`weekly_chest`, `chest_gold`, `chest_relic`) inside a claim transaction SHALL credit `chestBonusXp` and `chestBonusSeals`, deterministically unlock one unowned active pool cosmetic matching the tier's rarity band, and roll consumable drops on `chest_gold` and `chest_relic`. When a tier's pool is exhausted, the cosmetic slot SHALL convert into extra Seals (`+25`/`+45`/`+80`/`+150`) plus `+50` Guild XP.

#### Scenario: Opening a Gold chest prefers rare unowned cosmetics
- **WHEN** a user claims a Rank `A` contract carrying `chest_gold` while unowned `rare` pool cosmetics exist
- **THEN** `chestResult` records `chestKind: "chest_gold"`, `bonusXp`, `bonusSeals`, `unlockedCosmetic`, and optional `grantedConsumable`

#### Scenario: Exhausted Silver chest pool converts to Guild Seals
- **WHEN** a user owning all `common` and `uncommon` chest cosmetics opens `chest_silver`
- **THEN** `chestResult.unlockedCosmetic` is `null` and `chestResult.bonusSeals` includes the `+45` Seals fallback

### Requirement: Unified inventory read and zero-extra-query profile guarantee
`GET /v1/guild/rewards` SHALL return all permanently unlocked Guild cosmetics, current consumable quantities, `sealsBalance`, and all equipped customization keys. `GET /v1/profile` and `GET /v1/profile/:id` SHALL continue exposing only `guildTitleKey` and `guildFrameKey` from `profile` with zero additional SQL queries.

#### Scenario: Rewards endpoint returns expanded inventory and seals balance
- **WHEN** a user calls `GET /v1/guild/rewards`
- **THEN** the response includes unlocked cosmetics across all equippable kinds, `consumables`, `sealsBalance`, and all equipped Guild slots
