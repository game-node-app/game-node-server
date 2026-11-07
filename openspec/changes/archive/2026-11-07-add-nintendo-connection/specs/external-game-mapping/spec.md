# Spec Delta

## MODIFIED Requirements

### Requirement: GameNode-only mapping categories
The system SHALL support mapping categories that IGDB does not define, using values outside IGDB's external game source range. `EpicGamesNamespace` SHALL map an Epic Games catalog `namespace` to a catalog game. `NintendoTitleId` SHALL map a 16-hex Nintendo Switch title ID to a catalog game.

#### Scenario: Looking up an Epic namespace
- **WHEN** an importer looks up mappings for category `EpicGamesNamespace` and source ID `9773aa1aa54f4f7b80e44bef04986cea`
- **THEN** the system returns the catalog game mapped to that namespace, if one exists

#### Scenario: Looking up a Nintendo title ID
- **WHEN** an importer looks up mappings for category `NintendoTitleId` and source ID `0100BA0018500000`
- **THEN** the system returns the catalog game mapped to that title ID, if one exists

#### Scenario: Curating a Nintendo title
- **WHEN** an admin maps an active `NintendoTitleId` unmapped entry to a catalog game, through the moderator endpoint or the MCP mapping tool
- **THEN** a non-IGDB mapping for that title ID exists, and later Nintendo imports of any user match it
