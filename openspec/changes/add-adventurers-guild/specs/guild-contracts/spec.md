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

### Requirement: Previously finished games cannot be contract targets
For a `finish_game` contract, a `targetGameId` that the user has ever finished (per the library status history) or that is currently `finished` SHALL be rejected with 400, even if the entry was later moved to another status. Review contracts MAY target finished games.

#### Scenario: Game finished in the past cannot be bound after a status toggle
- **WHEN** a user moves a game they finished last year back to `playing` and tries to accept a `deep_dive` quest targeting it
- **THEN** the system rejects the request with 400

### Requirement: Contract deadlines
A board contract's `expiresAt` SHALL be `acceptedAt` plus its template's contract duration: 21 days for `library` templates and 7 days for `weekly` and `gamenode` templates. A curated event contract's `expiresAt` SHALL be the event's `endsAt`.

#### Scenario: Board contract deadline is relative to acceptance
- **WHEN** a user accepts a `Relíquia Esquecida` board quest on Sunday 23:00 São Paulo time
- **THEN** the contract's `expiresAt` is 21 days after `acceptedAt`, not the next Monday refresh

### Requirement: Concurrency cap and duplicate acceptance prevention
A user SHALL hold at most 3 concurrent non-terminal contracts (`active` or `ready_to_claim`); attempting to accept a 4th SHALL fail with 409 (`code: "guild_active_contract_limit_reached"`). Accepting a `boardEntryId` or `eventId` for which the user already holds an `active`, `ready_to_claim`, or `completed` contract SHALL fail with 409 (`code: "guild_contract_already_exists"`). Concurrent accept requests per user SHALL be serialized.

#### Scenario: Active contract limit enforced
- **WHEN** a user already has 2 `active` contracts and 1 `ready_to_claim` contract and tries to accept another quest
- **THEN** the system rejects the request with 409 and `code: "guild_active_contract_limit_reached"`

#### Scenario: Duplicate acceptance rejected
- **WHEN** a user submits two concurrent accept requests for the same board entry or curated event
- **THEN** at most one contract is created and the other request fails with 409 (`code: "guild_contract_already_exists"`)

### Requirement: Only post-acceptance actions count toward contract completion
Progress evaluation SHALL consider only qualifying facts that happened at or after the contract's `acceptedAt`, strictly before `expiresAt` (when set), and not after the evaluation instant. Actions committed before acceptance SHALL NOT fulfill a newly accepted contract.

#### Scenario: Previously finished game does not auto-complete an event contract
- **WHEN** a user finished a Metroidvania game yesterday and accepts `Mês do Metroidvania` today
- **THEN** the contract starts at `progressCurrent = 0` and remains `active` until a qualifying Metroidvania game is finished at or after `acceptedAt`

### Requirement: Game completions count only first finishes from manual library actions
For `finish_game` progress, a game SHALL count only when its first-ever finish, as recorded with server time in the library status history, falls inside the contract window and came from a manual library action. Client-supplied `finishedAt` values, re-finishing games finished earlier, library imports, and finishes propagated to related entries (such as DLCs) SHALL NOT count.

#### Scenario: Re-finishing an already finished game does not count
- **WHEN** a user accepts a `weekend_sprint` contract, moves a game finished in 2024 back to `planned`, and marks it `finished` again (or re-saves it with `finishedAt` set to now)
- **THEN** the contract stays at `progressCurrent = 0`

#### Scenario: Related entries do not multiply progress
- **WHEN** a user with an active "finish 3 games" event contract marks a game `finished` together with 2 related DLC entries
- **THEN** the contract progresses by at most 1

### Requirement: Review progress counts distinct substantive reviews
For `write_review` progress, the qualifying fact SHALL be `review.createdAt`, counting distinct reviewed games whose trimmed review content has at least 80 characters.

#### Scenario: Short or repeated reviews do not count twice
- **WHEN** a user with an active 3-review contract publishes two reviews with fewer than 80 characters and one qualifying review
- **THEN** the contract reports `progressCurrent = 1`

### Requirement: Asynchronous progress tracking from committed user actions
Committed game finishes, new reviews, and playtime updates SHALL schedule asynchronous contract evaluation for the affected user without blocking or failing the originating mutation. `finish_game` contracts SHALL evaluate `targetGameId` and configured game criteria (`gameIds`, `genreIds`, `themeIds`, `keywordIds`, `maxTimeToBeatHours`); `write_review` contracts SHALL evaluate qualifying reviews (including `finishedInCurrentMonth` when configured).

#### Scenario: Finishing the targeted game advances the contract
- **WHEN** a user marks `Hollow Knight` as `finished` after accepting a `Relíquia Esquecida` contract targeting `Hollow Knight`
- **THEN** asynchronous evaluation transitions the contract to `ready_to_claim` with `progressCurrent = 1`

#### Scenario: Writing reviews advances a weekly review contract
- **WHEN** a user accepts a 3-review weekly contract and publishes 1 new qualifying review afterward
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
`POST /v1/guild/contracts/:id/claim` SHALL verify ownership (404 otherwise) and `ready_to_claim` status (409 otherwise), then in one locked transaction mark the contract `completed`, increment `guild_profile.xp` and recompute `rank`, credit global `UserLevel` XP, grant any linked reward, persist `claimPayload`, and return the receipt (`contract`, `xpAwarded`, `globalXpAwarded`, `rankBefore`, `rankAfter`, `unlockedRewards`, `chestResult`). Concurrent claims SHALL succeed at most once.

#### Scenario: Claiming a ready contract awards XP, rank-up, and reward
- **WHEN** a user at Rank `C` (1,900 Guild XP) claims a `ready_to_claim` Rank `B` contract worth 250 XP with linked badge `badge_archaeologist`
- **THEN** the contract becomes `completed`, Guild XP becomes 2,150 (`rankBefore: "C"`, `rankAfter: "B"`), global `UserLevel` increases by 62 XP (`globalXpAwarded: 62`), the linked achievement is granted, and the receipt is returned

### Requirement: Global XP conversion on claim
`xpAwarded` SHALL be the Guild XP of the claim (contract XP plus reward bonuses). The global `UserLevel` XP credited SHALL be `globalXpAwarded = floor(xpAwarded × 0.25)`.

#### Scenario: Claim converts Guild XP to a quarter of global XP
- **WHEN** a user claims a contract that awards 330 Guild XP including bonuses
- **THEN** the receipt reports `xpAwarded: 330` and `globalXpAwarded: 82`

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

### Requirement: Event deadline changes reach active contracts
When a curated event's `endsAt` changes, its `active` contracts SHALL adopt the new `endsAt` as `expiresAt`; `ready_to_claim` and terminal contracts SHALL be unaffected.

#### Scenario: Extending an event extends its active contracts
- **WHEN** an editor extends a published event's `endsAt` by one week while users hold `active` contracts for it
- **THEN** those contracts' `expiresAt` moves to the new `endsAt`

### Requirement: Listing and filtering user contracts
`GET /v1/guild/contracts` SHALL return the authenticated user's contracts with pagination (`offset`, `limit`), supporting filtering by `status` (`active`, `ready_to_claim`, `completed`, `abandoned`, `expired`) or `tab` (`accepted` for `active` + `ready_to_claim`, `completed` for `completed`), ordered with `ready_to_claim` first on `tab=accepted` and `updatedAt DESC` otherwise.

#### Scenario: Fetching the Accepted tab returns both active and ready_to_claim contracts
- **WHEN** a user requests `GET /v1/guild/contracts?tab=accepted`
- **THEN** both `active` and `ready_to_claim` contracts are returned, with `ready_to_claim` items ordered first
