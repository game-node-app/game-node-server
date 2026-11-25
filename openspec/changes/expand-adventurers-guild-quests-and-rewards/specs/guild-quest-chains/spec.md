# Spec Delta

## Purpose

Introduces multi-stage narrative Quest Chains (Lina's Arcs) where players progress sequentially through linked contract stages toward an arc-exclusive cosmetic reward.

## ADDED Requirements

### Requirement: Code-defined multi-stage Quest Chains catalog
The system SHALL expose a code-defined catalog of 3-stage narrative Quest Chains (`pathfinders_arc` `minRank: E`, `curators_arc` `minRank: D`, `relic_hunters_arc` `minRank: C`) via `GET /v1/guild/chains`, returning each chain's `status` (`locked`, `available`, `in_progress`, `completed`), `currentStageIndex`, `boundGame`, active `contractId`, stage definitions, and exclusive final cosmetic rewards.

#### Scenario: Listing chains reflects rank locks and active progress
- **WHEN** a Rank `D` user who started `pathfinders_arc` calls `GET /v1/guild/chains`
- **THEN** `pathfinders_arc` is `"in_progress"`, `curators_arc` is `"available"`, and `relic_hunters_arc` is `"locked"` (`minRank: "C"`)

### Requirement: Starting a Quest Chain
`POST /v1/guild/chains/:chainKey/start` (with optional `targetGameId` when Stage 1 requires one) SHALL enforce `rank >= chain.minRank` (`403 guild_chain_rank_required`), prevent duplicate starts (`409 guild_chain_already_started` / `guild_chain_already_completed`), enforce the user's active contract cap, persist `guild_user_chain`, and create the Stage 1 contract linked via `chainProgressId`.

#### Scenario: Starting Pathfinder's Arc binds the target game to Stage 1
- **WHEN** a user calls `POST /v1/guild/chains/pathfinders_arc/start` with an eligible `planned` game `Celeste`
- **THEN** `guild_user_chain` is created with `boundTargetGameId = Celeste` and Stage 1 (`log_playtime`, 2 hours) becomes an `active` contract

### Requirement: Sequential stage progression, retry safety, and arc completion
Claiming a non-final chain stage contract SHALL advance `currentStageIndex` so `POST /v1/guild/chains/:chainKey/advance` starts the next stage (inheriting `boundTargetGameId` when configured). Abandoning or expiring a stage contract SHALL keep `currentStageIndex` retryable without losing earlier stages. Claiming the final stage SHALL mark the chain `completed`, grant its exclusive final cosmetics and bonus Seals, and emit `lina.trigger = "chain_completed"`.

#### Scenario: Completing Stage 1 unlocks Stage 2 bound to the same game
- **WHEN** a user claims Stage 1 of `pathfinders_arc` bound to `Celeste` and calls `POST /v1/guild/chains/pathfinders_arc/advance`
- **THEN** Stage 2 (`finish_game`) starts automatically bound to `targetGameId = Celeste`

#### Scenario: Abandoning Stage 2 keeps Stage 1 completed
- **WHEN** a user abandons their active Stage 2 contract in `pathfinders_arc`
- **THEN** `currentStageIndex` remains on Stage 2 and calling `advance` creates a fresh Stage 2 contract

#### Scenario: Claiming final Stage 3 completes the chain with exclusive rewards
- **WHEN** a user claims Stage 3 of `pathfinders_arc`
- **THEN** the chain becomes `"completed"`, `title_pathfinder` and `decor_compass_rose` unlock permanently, and `lina.trigger` is `"chain_completed"`
