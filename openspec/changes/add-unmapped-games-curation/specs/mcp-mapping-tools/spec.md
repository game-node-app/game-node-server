# Spec Delta

## Purpose

Lets an admin's AI agent work through the unmapped external games queue over MCP: read entries, search the catalog, and write or dismiss mappings. Visibility depends on the user's role, and every mapping the agent writes is recorded as agent-made so it can be audited and rolled back.

## ADDED Requirements

### Requirement: Admin-only tool visibility
`list_unmapped_games`, `map_external_game` and `dismiss_unmapped_game` SHALL be listed and callable only when the token's user holds the `ADMIN` role at the time of the request. For any other user, `tools/list` SHALL omit them and a call to them SHALL fail without changing data: with the scope refusal when the token lacks `mappings:write`, otherwise as an unknown tool.

#### Scenario: Admin lists tools
- **WHEN** an admin's client with a valid token sends `tools/list`
- **THEN** the response includes the three mapping tools alongside the regular GameNode tools

#### Scenario: Regular user lists tools
- **WHEN** a user without the `ADMIN` role sends `tools/list`
- **THEN** none of the mapping tools are listed

#### Scenario: Regular user calls a mapping tool
- **WHEN** a user without the `ADMIN` role calls `map_external_game`, even with a token holding `mappings:write`
- **THEN** the call fails as an unknown tool and no mapping is written

#### Scenario: Role removed while a token is valid
- **WHEN** an admin loses the `ADMIN` role and their client sends its next request with the same unexpired token
- **THEN** the mapping tools are no longer listed or callable

### Requirement: Mapping tools scope
Each mapping tool SHALL require the `mappings:write` scope. A call whose token lacks it SHALL be refused with HTTP 403 and an `insufficient_scope` challenge naming `mappings:write`.

#### Scenario: Admin token without the scope
- **WHEN** an admin's client whose token lacks `mappings:write` calls `list_unmapped_games`
- **THEN** the response is HTTP 403 with `WWW-Authenticate` error `insufficient_scope` and `scope="mappings:write"`

### Requirement: List unmapped games tool
`list_unmapped_games` SHALL accept an optional `category`, an optional `page` and a `limit` from 1 to 50 (default 20). It SHALL return active unmapped entries in the order of the moderator unmapped list. Each entry SHALL include id, source ID, category name, name, owner count, and a store page URL when one can be built from the source ID.

#### Scenario: Steam entry
- **WHEN** the tool returns an unmapped Steam entry with app ID `412020`
- **THEN** the entry includes the name, the owner count and `https://store.steampowered.com/app/412020`

#### Scenario: Epic entry
- **WHEN** the tool returns an unmapped Epic namespace entry
- **THEN** the entry includes the name if known and no store page URL

### Requirement: Map external game tool
`map_external_game` SHALL accept an unmapped entry `id` and a catalog `game_id`, then create a mapping from that entry's source ID and category to the game, with origin `agent`, and deactivate the entry. The result SHALL name the mapped game.

#### Scenario: Mapping an active entry
- **WHEN** the tool is called with an active entry and an existing game
- **THEN** a mapping with origin `agent` exists for that source ID and category, the entry is inactive, and the result names the game

#### Scenario: Unknown game
- **WHEN** the tool is called with a `game_id` that does not exist
- **THEN** the tool returns a not-found error and nothing changes

### Requirement: Agent mappings never overwrite
`map_external_game` SHALL refuse, with a tool error and without changing data, when the entry is unknown or inactive, or when any mapping of any origin already exists for the entry's source ID and category.

#### Scenario: Entry already resolved
- **WHEN** the tool is called with an entry a moderator already mapped or dismissed
- **THEN** the tool returns an error stating the entry is no longer active, and nothing changes

#### Scenario: Mapping appeared after registration
- **WHEN** the tool is called with an active entry whose source ID and category gained a mapping after the entry was registered
- **THEN** the tool returns an error stating a mapping already exists, the existing mapping is unchanged, and the entry stays active

### Requirement: Dismiss unmapped game tool
`dismiss_unmapped_game` SHALL accept an unmapped entry `id` and dismiss it with the same effect as the moderator dismiss endpoint. An unknown or inactive entry SHALL return a tool error.

#### Scenario: Dismissing a launcher
- **WHEN** the tool is called with the active entry of a game launcher
- **THEN** the entry is inactive and no mapping is created

### Requirement: Mapping tools write limits
`map_external_game` and `dismiss_unmapped_game` SHALL be write tools: they are refused for suspended or banned users and count toward the shared MCP write limit of 10 calls per user per 60 seconds. `list_unmapped_games` SHALL be read-only.

#### Scenario: Agent maps in a loop
- **WHEN** an admin's agent calls `map_external_game` an 11th time within 60 seconds
- **THEN** the call returns a rate-limit tool error and no mapping is written
