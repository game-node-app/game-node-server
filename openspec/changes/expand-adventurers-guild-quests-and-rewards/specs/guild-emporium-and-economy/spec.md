# Spec Delta

## Purpose

Manages Guild Seals currency and its append-only audit ledger, Lina's Emporium shop (rank-gated permanent catalog plus deterministic monthly rotating showcase), and Guild utility consumables (Hourglass, Reroll Charter, Extra Slot Permit).

## ADDED Requirements

### Requirement: Guild Seals balance and append-only ledger
Each `guild_profile` SHALL maintain a non-negative `sealsBalance`. Every credit and debit SHALL execute under a `FOR UPDATE` lock on `guild_profile` and append an immutable row to `guild_seal_ledger` (`delta`, `balanceAfter`, `reason`, `referenceId`, `createdAt`). `sealsBalance` SHALL never become negative.

#### Scenario: Claiming a contract credits Seals and records a ledger row
- **WHEN** a user with `sealsBalance = 40` claims a Rank `C` contract worth 35 Seals
- **THEN** `sealsBalance` becomes `75` and one `guild_seal_ledger` row records `delta: +35, balanceAfter: 75, reason: "contract_claim"`

### Requirement: Lina's Emporium permanent catalog and monthly rotating showcase
`GET /v1/guild/emporium` SHALL return `sealsBalance`, São Paulo `monthKey`, `nextRotationAt`, `permanentItems`, and up to 6 `rotatingItems` chosen deterministically for `monthKey` via `seededOrder(sha256("emporium:" + monthKey), rotatingPool, id)`. Each listing SHALL include `priceSeals`, `minRank`, `reward`, `maxPurchasesPerMonth`, `owned`, `purchasedThisMonth`, and `canPurchase`.

#### Scenario: Two users see the same monthly rotating showcase with personalized affordability
- **WHEN** two users of different ranks call `GET /v1/guild/emporium` in the same São Paulo month
- **THEN** both receive the identical `rotatingItems` selection while `owned` and `canPurchase` reflect each user's own rank, inventory, and balance

### Requirement: Atomic Emporium purchase enforcement
`POST /v1/guild/emporium/purchase` (`{ emporiumItemId }`) SHALL verify active availability (404 otherwise), lock `guild_profile` `FOR UPDATE`, and enforce `rank >= minRank` (`403 guild_emporium_rank_required`), unowned cosmetics (`409 guild_emporium_already_owned`), monthly caps (`409 guild_emporium_monthly_limit_reached`), and `sealsBalance >= priceSeals` (`409 guild_insufficient_seals`), atomically debiting Seals and granting the item.

#### Scenario: Purchasing a cosmetic deducts Seals and unlocks permanently
- **WHEN** a Rank `C` user with 150 Seals buys a Rank `C` `license_theme` for 120 Seals
- **THEN** `sealsBalance` becomes `30`, the theme unlocks in `user_guild_reward`, and a concurrent or repeat purchase fails with 409 (`guild_emporium_already_owned`)

#### Scenario: Purchasing above rank or balance fails without mutating balance
- **WHEN** a Rank `D` user attempts to buy a Rank `A` item or an item costing more than their `sealsBalance`
- **THEN** the request fails with 403 (`guild_emporium_rank_required`) or 409 (`guild_insufficient_seals`) and `sealsBalance` is unchanged

### Requirement: Guild utility consumables (`hourglass`, `reroll_charter`, `extra_slot_permit`)
The system SHALL track per-user consumable balances in `guild_consumable_inventory` for `hourglass`, `reroll_charter`, and `extra_slot_permit`. `POST /v1/guild/consumables/extra_slot_permit/activate` SHALL consume 1 permit and set `extraSlotPermitWeekStart` to the current São Paulo week (`409 guild_permit_already_active` if already active this week, `409 guild_consumable_not_owned` if balance is 0).

#### Scenario: Activating Extra Slot Permit grants +1 slot for the current week
- **WHEN** a user owning 1 `extra_slot_permit` calls `POST /v1/guild/consumables/extra_slot_permit/activate`
- **THEN** inventory becomes 0, `extraSlotPermitWeekStart` is set to the current week, and a second activation this week fails with 409 (`guild_permit_already_active`)

### Requirement: Admin Emporium catalog management
`ADMIN` and `EDITOR` users SHALL be able to list, create, and update Emporium listings via `GET/POST /v1/guild/admin/emporium` and `PATCH /v1/guild/admin/emporium/:id` (`rewardId`, `priceSeals >= 1`, `minRank`, `isRotating`, `maxPurchasesPerMonth`, `isActive`).

#### Scenario: Editor adds a seasonal cosmetic to the monthly rotating Emporium pool
- **WHEN** an editor posts `{ rewardId, priceSeals: 140, minRank: "D", isRotating: true }` to `POST /v1/guild/admin/emporium`
- **THEN** the listing is persisted and enters the monthly showcase rotation pool
