# Spec Delta

## Purpose

Enables administrators and editors to create, translate, publish, and archive curated Guild events (such as seasonal genre challenges) and manage the Guild reward catalog with validated criteria and date windows.

## ADDED Requirements

### Requirement: Admin and editor access control
All endpoints under `/v1/guild/admin/events` and `/v1/guild/admin/rewards` SHALL require an authenticated user with role `ADMIN` or `EDITOR`. Unauthenticated requests SHALL receive 401 and authenticated users without those roles SHALL receive 403.

#### Scenario: Regular user cannot create a curated event
- **WHEN** an authenticated regular user calls `POST /v1/guild/admin/events`
- **THEN** the system responds with 403

### Requirement: Curated event CRUD and criteria validation
Admins and editors SHALL be able to list, read, create, and update curated Guild events (`GET/POST /v1/guild/admin/events`, `GET/PATCH /v1/guild/admin/events/:id`). Payloads SHALL validate unique `slug`, non-empty `title`/`description`, valid `rank` (`E`–`S`), positive `xpReward`, `endsAt > startsAt`, supported `objectiveType` (`finish_game` or `write_review`) with `targetCount >= 1`, valid objective criteria, and an active `rewardId` if supplied (400 on invalid input, 409 on duplicate `slug`).

#### Scenario: Creating a valid genre event
- **WHEN** an editor posts an event with `slug: "metroidvania-month-2026"`, `rank: "A"`, `xpReward: 400`, `objectiveType: "finish_game"`, `criteria: { genreIds: [8], keywordIds: [2045] }`, valid window, and a valid frame `rewardId`
- **THEN** the event is created in status `draft` and returned with its `translations`

#### Scenario: Invalid window or unsupported criteria is rejected
- **WHEN** an editor posts an event with `endsAt <= startsAt` or `maxTimeToBeatHours` on a `write_review` objective
- **THEN** the request is rejected with 400

### Requirement: Curated event per-locale translations
Curated events SHALL store base `title`/`description` plus optional `translations` (`{ locale, title, description }` for `en` and `pt-BR`), rejecting unsupported or duplicate locales and empty strings with 400. Updating with `translations` replaces the set atomically, omitting preserves it, and `[]` clears it. Every admin and player event response SHALL include `translations` (`[]` when empty) without a locale query parameter.

#### Scenario: Saving event with en and pt-BR translations
- **WHEN** an editor creates or updates an event with translations for both `en` and `pt-BR`
- **THEN** both translations are stored and returned on admin reads, board reads, and contract reads

#### Scenario: Duplicate locale rejected
- **WHEN** an editor submits two `pt-BR` entries in `translations`
- **THEN** the request is rejected with 400 and existing translations remain unchanged

### Requirement: Event publishing and archiving lifecycle
Curated events SHALL start in `draft`, transition to `published` via `POST /v1/guild/admin/events/:id/publish` (requiring `endsAt > now` and, when linked to a `badge` reward, a `published` `AchievementDefinition`), and transition to `archived` via `POST /v1/guild/admin/events/:id/archive`. Archiving SHALL remove the event from open boards while allowing existing contracts to complete and be claimed.

#### Scenario: Archiving preserves in-flight contracts
- **WHEN** an editor archives a published event while a user holds an `active` contract for it
- **THEN** new users no longer see the event on `GET /v1/guild/board`
- **AND** the existing user's contract can still progress and be claimed

### Requirement: Curated event rules lock after acceptance
Once at least one user has accepted a contract for a curated event, `PATCH /v1/guild/admin/events/:id` SHALL reject modifications to `objectiveType`, `criteria`, `targetCount`, `xpReward`, or `rewardId` with 409 (`code: "guild_event_rules_locked"`), while still allowing updates to `title`, `description`, `translations`, and extending `endsAt`.

#### Scenario: Rules cannot mutate after contracts exist
- **WHEN** an editor tries to change `xpReward` or `criteria` on an event that already has accepted contracts
- **THEN** the request fails with 409 (`code: "guild_event_rules_locked"`)

### Requirement: Admin reward catalog management
Admins and editors SHALL be able to list, create, update, and toggle active state on Guild rewards (`GET/POST /v1/guild/admin/rewards`, `PATCH /v1/guild/admin/rewards/:id`), validating unique `key`, valid `kind` (`badge`, `title`, `avatar_frame`, `weekly_chest`), required existing `achievementId` when `kind === "badge"`, and rejecting `inChestPool: true` for kinds other than `title` and `avatar_frame`.

#### Scenario: Creating a new event avatar frame reward
- **WHEN** an editor creates a reward `{ key: "frame_metroidvania_2026", kind: "avatar_frame", inChestPool: false }`
- **THEN** the reward is persisted and can immediately be linked to a curated event

#### Scenario: Badge reward requires a valid achievement definition
- **WHEN** an editor creates a `badge` reward with a missing or nonexistent `achievementId`
- **THEN** the request is rejected with 400
