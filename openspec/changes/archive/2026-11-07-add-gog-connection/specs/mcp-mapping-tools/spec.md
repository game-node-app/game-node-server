# Spec Delta

## MODIFIED Requirements

### Requirement: List unmapped games tool
`list_unmapped_games` SHALL accept an optional `category` including `Gog`, an optional `page` and a `limit` from 1 to 50 (default 20). It SHALL return active unmapped entries without any mapping, in the order of the moderator unmapped list. Each entry SHALL include id, source ID, category name, name, owner count, and a store page URL when one can be built from the source ID.

#### Scenario: Steam entry
- **WHEN** the tool returns an unmapped Steam entry with app ID `412020`
- **THEN** the entry includes the name, the owner count and `https://store.steampowered.com/app/412020`

#### Scenario: Epic entry
- **WHEN** the tool returns an unmapped Epic namespace entry
- **THEN** the entry includes the name if known and no store page URL

#### Scenario: GOG category filter
- **WHEN** an authorized admin calls `list_unmapped_games` with `category: "Gog"`
- **THEN** only active unmapped GOG entries are returned, using their GOG product IDs, without fabricated store URLs

#### Scenario: Resolving a GOG entry
- **WHEN** an authorized admin maps an active GOG entry through `map_external_game`
- **THEN** an `agent` mapping is created in category `Gog` under the existing conflict and permission rules, and the entry becomes inactive
