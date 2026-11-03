# Spec Delta

## MODIFIED Requirements

### Requirement: Unmapped registration from player syncs and imports
When a Steam, PSN, Xbox, Epic Games or GOG playtime sync or import sees a source ID with no mapping in that provider's category, the system SHALL register it as an unmapped entry keyed by source ID and category. Registering an existing entry SHALL NOT create a duplicate or change whether it is active.

#### Scenario: Xbox title without a mapping
- **WHEN** an Xbox playtime sync sees a product ID that has no `Microsoft` mapping
- **THEN** an active unmapped entry exists for that product ID and category `Microsoft`

#### Scenario: Same game seen again
- **WHEN** a second user's Steam sync sees an app ID that already has an active unmapped entry
- **THEN** no second entry is created for that app ID

#### Scenario: Resolved entry seen again
- **WHEN** a sync sees a source ID whose unmapped entry is inactive and which still has no mapping
- **THEN** the entry stays inactive

#### Scenario: Unmapped GOG product
- **WHEN** a GOG import or playtime sync sees an owned product without a `Gog` mapping
- **THEN** an unmapped entry exists under its product ID and category `Gog`, with the current owner and a provider title when available

#### Scenario: GOG metadata lookup fails
- **WHEN** a product title cannot be retrieved for an unmapped GOG ID
- **THEN** registration proceeds without a name, preserves a previously known name, and does not fail the otherwise complete library import
