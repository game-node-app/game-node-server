# Connection Provider Registry Specification

## Purpose

Defines a declarative provider registration and dispatch model for connection authentication modes, capability discovery, synchronization pipelines, and rate-limit budgets so new platforms (GOG, Epic Games, Ubisoft Connect, Nintendo) can be added without modifying core orchestration logic.

## Requirements

### Requirement: Declarative provider capability and auth-mode discovery
The system SHALL maintain a central `ConnectionProviderRegistry` where each supported `EConnectionType` registers its display metadata, supported `authMode` (`redirect`, `public_identifier`, or `delegated_code`), and synchronization capabilities (`isImporterViable`, `isImporterWatchViable`, `isPlaytimeImportViable`, `isAchievementImportViable`). `GET /v1/connections` SHALL derive its response directly from the registry, including `authMode` for each provider.

#### Scenario: Client queries available connection providers
- **WHEN** a client requests `GET /v1/connections`
- **THEN** the response lists each registered provider along with its capability flags and `authMode` (`"redirect"` for `steam` and `xbox`, `"public_identifier"` for `psn`, `"delegated_code"` for `epicgames`)

#### Scenario: Epic Games capabilities
- **WHEN** a client requests `GET /v1/connections`
- **THEN** `epicgames` reports importer, importer-watch and playtime import as viable, and achievement import as not viable

### Requirement: Registry-driven onboarding and synchronization dispatch
Connection onboarding (`ConnectionsService`), background playtime refresh (`PlayerDataProcessor` / `PlaytimeWatchProcessor`), library discovery (`ImporterService`), and obtained achievement fetching (`GameObtainedAchievementService`) SHALL resolve provider handlers through the registry rather than hard-coded provider switch statements.

#### Scenario: Registering and executing a provider sync stage
- **WHEN** `PlayerDataProcessor` or `ImporterService` executes work for a connection `type`
- **THEN** it dispatches to the registered provider handler for that `type` and throws an `UnrecoverableError` or HTTP 400 if the provider is not registered for that capability

### Requirement: Scope-aware provider rate-limit budgeting
`PlayerProviderBudgetService` SHALL validate provider names against registered providers and support both global provider budgets (for server-keyed APIs such as `Steam` and `PSN`) and user-scoped or hybrid budgets (for per-user OAuth APIs such as `Xbox` where player calls use the user's own XSTS token).

#### Scenario: Throttling on one user's Xbox token does not block unrelated Xbox users
- **WHEN** an Xbox player-scoped API call using a specific connection's XSTS token receives HTTP 429
- **THEN** the cooldown applies to that connection's budget scope rather than halting Xbox synchronization for all other users' independent tokens

### Requirement: Shared library matching across providers
Library discovery SHALL match every provider's source game IDs through one shared path. That path SHALL exclude entries the user already imported or ignored (unless processed entries are requested), look up mappings for the provider's category, and attach the provider's preferred platform. Steam, PSN, Xbox and Epic Games SHALL return the same results as with per-provider matching.

#### Scenario: Unprocessed entries for any provider
- **WHEN** `ImporterService` lists unprocessed entries for a connection whose provider returned source IDs
- **THEN** the result contains one item per mapped external game not yet processed or ignored by the user, each with the provider's preferred platform

#### Scenario: Including processed entries
- **WHEN** unprocessed entries are requested with processed entries included
- **THEN** every mapping of every returned source ID is listed, including ones the user already processed or ignored
