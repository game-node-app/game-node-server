# Spec Delta

## Purpose

Adds Rank promotion reward packages, rank-unlocked functional perks, endless Prestige S+ progression, Guild License customization (themes, stamps, Lina's counter decor, 3-badge Trophy Showcase), and expanded Lina dialogue triggers.

## ADDED Requirements

### Requirement: Rank promotion reward packages and functional perks
Crossing a Guild Rank threshold (`D`, `C`, `B`, `A`, or `S`) SHALL atomically grant that rank's promotion cosmetics at most once (tracked by `highestPromotedRank`) and unlock its functional perks: Rank `D` (1 free weekly reroll), Rank `C` (Monthly Expedition slot), Rank `B` (4 active contracts), Rank `A` (Rank `S` expeditions + 1 free monthly Hourglass), and Rank `S` (2 free weekly rerolls + Legendary quests). Multi-rank jumps SHALL grant all crossed packages in order.

#### Scenario: Reaching Rank B grants cosmetics and raises contract cap to 4
- **WHEN** a Rank `C` user (1,900 XP) claims a 250 XP contract
- **THEN** rank becomes `B`, `frame_forged_steel` and `decor_sleeping_cat` unlock in `promotionRewards`, and `license.perks.maxActiveContracts` becomes `4`

#### Scenario: Pre-migration members receive missed promotion packages lazily
- **WHEN** an existing member with 2,200 XP (Rank `B`) calls `GET /v1/guild` for the first time after migration
- **THEN** Rank `D`, `C`, and `B` promotion packages are idempotently granted once

### Requirement: Endless Prestige S+ progression beyond Rank S
Once a member reaches Rank `S` (`7,500 XP`), every additional `2,500 Guild XP` earned SHALL increment `prestigeLevel` (`floor(max(0, xp - 7500) / 2500)`). Each newly reached Prestige star SHALL atomically open a `chest_relic` and award bonus Seals inside the granting transaction, returned in `prestigeRewards`. The License SHALL expose `prestigeLevel`, `prestigeXpIntoCurrent`, and `xpToNextPrestige`.

#### Scenario: Crossing 10,000 Guild XP grants Prestige 1 and a Relic Chest
- **WHEN** a Rank `S` member at 9,800 XP (`prestigeLevel: 0`) claims a 400 XP contract
- **THEN** `prestigeLevel` becomes `1`, a `chest_relic` opens in `prestigeRewards`, and the License reports `prestigeXpIntoCurrent: 200` and `xpToNextPrestige: 2300`

### Requirement: Guild License customization and Lina's counter decor
`guild_profile` SHALL store Guild-only customization (`equippedLicenseThemeKey`, `equippedStampStyleKey`, `equippedDecorKeys` up to 4 distinct `tavern_decor` keys, and `showcaseBadgeIds` up to 3 distinct owned achievement IDs). `PATCH /v1/guild/cosmetics` SHALL validate ownership of every item (`403 guild_cosmetic_not_owned`) and array limits (400) before writing. These fields SHALL add zero SQL queries to `GET /v1/profile` and `GET /v1/profile/:id`.

#### Scenario: Equipping license theme, stamp, tavern decor, and trophy showcase
- **WHEN** a user owning `license_obsidian_ledger`, `stamp_gold_seal`, `decor_sleeping_cat`, and `guild-archaeologist` calls `PATCH /v1/guild/cosmetics`
- **THEN** all four fields persist on `guild_profile` and appear on `GET /v1/guild` without adding SQL queries to `GET /v1/profile/:id`

#### Scenario: Exceeding decor or showcase limits is rejected
- **WHEN** a user submits 5 keys in `equippedDecorKeys` or 4 IDs in `showcaseBadgeIds`
- **THEN** `PATCH /v1/guild/cosmetics` responds with 400

### Requirement: Expanded Guild Overview and Lina dialogue triggers
`GET /v1/guild` SHALL add `sealsBalance`, Prestige fields, `perks`, and Guild-surface equipped keys to `license`, plus `passport`, `activeChain`, and `activeBountiesCount` summaries. `LinaTrigger` SHALL add `rank_promoted` (`happy`, on claim), `chain_completed` (`happy`, on final stage claim), `community_bounty_ready` (`happy`, prioritized right after `contract_ready_to_claim`), and `monthly_expedition_refreshed` (`neutral`).

#### Scenario: Claimable Community Bounty triggers Lina greeting
- **WHEN** a user with no ready contracts has an unclaimed completed Community Bounty and calls `GET /v1/guild`
- **THEN** `lina.trigger` is `"community_bounty_ready"` with `pose: "happy"`
