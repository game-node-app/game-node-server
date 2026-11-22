# Spec Delta

## Purpose

Controls accepting Guild quests into active contracts, evaluating progress asynchronously from committed user actions, transitioning fulfilled contracts through two-stage counter turn-in (`ready_to_claim` → `completed`), abandonment, and expiration.

## ADDED Requirements

### Requirement: Accepting a quest creates a contract with validated target
`POST /v1/guild/contracts` SHALL accept a current-week `boardEntryId` or an active `published` `eventId` and an optional `targetGameId`. When `requiresTargetGame` is true, `targetGameId` SHALL be required and MUST match an eligible library game for the quest criteria (400 otherwise). When supplied on an optional-target game quest, `targetGameId` MUST also match the criteria (400 otherwise). The response returns the created contract and Lina's acceptance confirmation context.

#### Scenario: Accepting a library backlog quest binds the target game
- **WHEN** a user accepts their `Relíquia Esquecida` board entry with `targetGameId` pointing to `Hollow Knight` (eligible in their backlog)
- **THEN** the system creates an `active` contract with `targetGameId = Hollow Knight`, `progressCurrent = 0`, `progressTarget = 1`, and returns the contract with Lina's acceptance confirmation context

#### Scenario: Missing or ineligible target game is rejected
- **WHEN** a user tries to accept a `requiresTargetGame: true` backlog quest without `targetGameId` or with a game already marked `finished`
- **THEN** the system rejects the request with 400

### Requirement: Concurrency cap and duplicate acceptance prevention
A user SHALL hold at most 3 concurrent non-terminal contracts (`active` or `ready_to_claim`); attempting to accept a 4th SHALL fail with 409 (`code: "guild_active_contract_limit_reached"`). Accepting a `boardEntryId` or `eventId` for which the user already holds an `active`, `ready_to_claim`, or `completed` contract SHALL fail with 409 (`code: "guild_contract_already_exists"`). Concurrent accept requests per user SHALL be serialized.

#### Scenario: Active contract limit enforced
- **WHEN** a user already has 2 `active` contracts and 1 `ready_to_claim` contract and tries to accept another quest
- **THEN** the system rejects the request with 409 and `code: "guild_active_contract_limit_reached"`

#### Scenario: Duplicate acceptance rejected
- **WHEN** a user submits two concurrent accept requests for the same board entry or curated event
- **THEN** at most one contract is created and the other request fails with 409 (`code: "guild_contract_already_exists"`)

### Requirement: Only post-acceptance actions count toward contract completion
Progress evaluation SHALL consider only qualifying facts whose relevant timestamp (`collection_entry.finishedAt` for game completions, `review.createdAt` for reviews) is at or after the contract's `acceptedAt` and strictly before `expiresAt` (when set). Actions committed before acceptance SHALL NOT fulfill a newly accepted contract.

#### Scenario: Previously finished game does not auto-complete an event contract
- **WHEN** a user finished a Metroidvania game yesterday and accepts `Mês do Metroidvania` today
- **THEN** the contract starts at `progressCurrent = 0` and remains `active` until a qualifying Metroidvania game is finished at or after `acceptedAt`

### Requirement: Asynchronous progress tracking from committed user actions
Committed game finishes, new reviews, and playtime updates SHALL schedule asynchronous contract evaluation for the affected user without blocking or failing the originating mutation. `finish_game` contracts SHALL evaluate `targetGameId` and configured game criteria (`gameIds`, `genreIds`, `themeIds`, `keywordIds`, `maxTimeToBeatHours`); `write_review` contracts SHALL evaluate qualifying reviews (including `finishedInCurrentMonth` when configured).

#### Scenario: Finishing the targeted game advances the contract
- **WHEN** a user marks `Hollow Knight` as `finished` after accepting a `Relíquia Esquecida` contract targeting `Hollow Knight`
- **THEN** asynchronous evaluation transitions the contract to `ready_to_claim` with `progressCurrent = 1`

#### Scenario: Writing reviews advances a weekly review contract
- **WHEN** a user accepts a 3-review weekly contract and publishes 1 new review afterward
- **THEN** evaluation updates the contract to `progressCurrent = 1`, `progressTarget = 3`, remaining `active`

### Requirement: Live playtime progress enrichment on active game contracts
When reading an `active` `finish_game` contract bound to a `targetGameId`, the response SHALL include `playtimeProgress: { playedSeconds, estimatedTotalSeconds, estimatedPercent }` derived from the user's accumulated playtime for that game and its cached time-to-beat, with `estimatedPercent` clamped to `0..99` while unfinished and `null` when `estimatedTotalSeconds` is unavailable.

#### Scenario: Active game contract reports playtime ratio
- **WHEN** a user has 18 hours of recorded playtime in `Hollow Knight` and cached time-to-beat is 29 hours while the contract is `active`
- **THEN** reading the contract reports `playtimeProgress: { playedSeconds: 64800, estimatedTotalSeconds: 104400, estimatedPercent: 62 }`

### Requirement: Two-stage completion via ready_to_claim
When an `active` contract's evaluated progress reaches `progressTarget` before `expiresAt`, the system SHALL atomically transition its status to `ready_to_claim`, set `readyAt`, and record a `guild.contract-ready` notification intent in the same transaction. Re-evaluating an already `ready_to_claim` or `completed` contract SHALL be a no-op, and later deletion of a review or un-finishing a game SHALL NOT revoke readiness.

#### Scenario: Reaching target moves contract to ready_to_claim without granting XP yet
- **WHEN** a user writes the 3rd qualifying review for an active 3-review contract
- **THEN** the contract becomes `ready_to_claim` and a `guild.contract-ready` notification intent is committed
- **AND** Guild XP, global `UserLevel` XP, and rewards are NOT granted until the user claims the contract

### Requirement: Atomic turn-in (claim) at Lina's counter
`POST /v1/guild/contracts/:id/claim` SHALL verify ownership (404 otherwise) and `ready_to_claim` status (409 otherwise), then in one locked transaction mark the contract `completed`, increment `guild_profile.xp` and recompute `rank`, credit global `UserLevel` XP, grant any linked reward, persist `claimPayload`, and return the receipt (`contract`, `xpAwarded`, `rankBefore`, `rankAfter`, `unlockedRewards`, `chestResult`). Concurrent claims SHALL succeed at most once.

#### Scenario: Claiming a ready contract awards XP, rank-up, and reward
- **WHEN** a user at Rank `C` (1,900 Guild XP) claims a `ready_to_claim` Rank `B` contract worth 250 XP with linked badge `badge_archaeologist`
- **THEN** the contract becomes `completed`, Guild XP becomes 2,150 (`rankBefore: "C"`, `rankAfter: "B"`), global `UserLevel` increases by 250 XP, the linked achievement is granted, and the receipt is returned

#### Scenario: Duplicate or concurrent claim is rejected
- **WHEN** two requests call `POST /v1/guild/contracts/:id/claim` concurrently on one `ready_to_claim` contract
- **THEN** exactly one succeeds with 200 and grants XP/rewards once, and the other fails with 409

#### Scenario: Claiming an unfinished contract is rejected
- **WHEN** a user calls `POST /v1/guild/contracts/:id/claim` on an `active` contract
- **THEN** the system rejects the request with 409 and changes nothing

### Requirement: Abandoning active contracts
`POST /v1/guild/contracts/:id/abandon` SHALL transition an owner's `active` contract to `abandoned` and free its active slot. Attempting to abandon a contract owned by another user SHALL fail with 404, and abandoning a contract in any status other than `active` SHALL fail with 409.

#### Scenario: Abandoning an active contract frees a slot
- **WHEN** a user with 3 active contracts calls `POST /v1/guild/contracts/:id/abandon` on one `active` contract
- **THEN** that contract becomes `abandoned` and the user can immediately accept a new quest

### Requirement: Automatic expiration of overdue active contracts
Any `active` contract whose `expiresAt` is in the past SHALL transition to `expired` (lazily on read/accept and via periodic cleanup) and stop counting toward the 3-contract active limit. A contract that reached `ready_to_claim` before `expiresAt` SHALL NOT expire and SHALL remain claimable.

#### Scenario: Overdue active contract expires while ready_to_claim stays claimable
- **WHEN** an event's `endsAt` passes while User A's contract is `active` and User B's contract is `ready_to_claim`
- **THEN** User A's contract transitions to `expired`
- **AND** User B's contract remains `ready_to_claim` and can still be claimed

### Requirement: Listing and filtering user contracts
`GET /v1/guild/contracts` SHALL return the authenticated user's contracts with pagination (`offset`, `limit`), supporting filtering by `status` (`active`, `ready_to_claim`, `completed`, `abandoned`, `expired`) or `tab` (`accepted` for `active` + `ready_to_claim`, `completed` for `completed`), ordered with `ready_to_claim` first on `tab=accepted` and `updatedAt DESC` otherwise.

#### Scenario: Fetching the Accepted tab returns both active and ready_to_claim contracts
- **WHEN** a user requests `GET /v1/guild/contracts?tab=accepted`
- **THEN** both `active` and `ready_to_claim` contracts are returned, with `ready_to_claim` items ordered first
