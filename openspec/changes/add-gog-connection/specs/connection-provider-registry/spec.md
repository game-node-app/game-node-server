# Spec Delta

## MODIFIED Requirements

### Requirement: Declarative provider capability and auth-mode discovery
The system SHALL maintain a central `ConnectionProviderRegistry` where each supported `EConnectionType` registers its display metadata, supported `authMode` (`redirect`, `public_identifier`, or `delegated_code`), and synchronization capabilities (`isImporterViable`, `isImporterWatchViable`, `isPlaytimeImportViable`, `isAchievementImportViable`). `GET /v1/connections` SHALL derive its response directly from the registry, including `authMode` for each provider.

#### Scenario: Client queries available connection providers
- **WHEN** a client requests `GET /v1/connections`
- **THEN** the response lists each registered provider along with its capability flags and `authMode` (`"redirect"` for `steam` and `xbox`, `"public_identifier"` for `psn`, `"delegated_code"` for `epicgames`)

#### Scenario: Epic Games capabilities
- **WHEN** a client requests `GET /v1/connections`
- **THEN** `epicgames` reports importer, importer-watch and playtime import as viable, and achievement import as not viable

#### Scenario: GOG capabilities
- **WHEN** a client requests `GET /v1/connections`
- **THEN** `gog` appears with name and icon `gog`, auth mode `delegated_code`, and importer, importer-watch, playtime-import and achievement-import flags all true

### Requirement: Shared library matching across providers
Library discovery SHALL match every provider's source game IDs through one shared path. That path SHALL exclude entries the user already imported or ignored (unless processed entries are requested), look up mappings for the provider's category, and attach the provider's preferred platform. Steam, PSN, Xbox and Epic Games SHALL return the same results as with per-provider matching.

#### Scenario: Unprocessed entries for any provider
- **WHEN** `ImporterService` lists unprocessed entries for a connection whose provider returned source IDs
- **THEN** the result contains one item per mapped external game not yet processed or ignored by the user, each with the provider's preferred platform

#### Scenario: Including processed entries
- **WHEN** unprocessed entries are requested with processed entries included
- **THEN** every mapping of every returned source ID is listed, including ones the user already processed or ignored

#### Scenario: GOG library matching
- **WHEN** the GOG library returns owned product IDs
- **THEN** they use existing `Gog` mappings with PC as the preferred platform and honor the same processed/ignored filtering as other providers
