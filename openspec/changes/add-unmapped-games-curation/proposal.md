# Proposal

## Why

When a sync or import sees a game GameNode cannot map, it records the source ID in `unmapped_external_game`. Today moderators can barely use this queue: entries carry only an opaque source ID (a Steam app id, a PSN concept id, an Epic hex namespace), with no name and no sign of how many users own the game. Xbox never adds anything to it. We also want admins to clear the queue with an AI agent over MCP. An agent can only do that if entries are identifiable and mapping writes are safe to undo.

## What Changes

- Unmapped entries store the game's name as the provider reports it. Steam, PSN, Xbox and Epic syncs and imports pass it. Epic names come from Epic's catalog service, since its library response has no title.
- Unmapped entries record which users own them. The list is ordered by owner count, so the most-owned games come first.
- Xbox playtime sync and Xbox imports register unmapped titles like the other providers.
- `GET /v1/game/external/unmapped` becomes paginated and filterable by category, and returns name and owner count. **BREAKING** for its admin-site consumer: the response changes from a bare array to the standard paginated shape.
- Moderators can dismiss an unmapped entry that is not a game (soundtracks, tools, launchers, demos). Dismissed entries never become active again.
- New mapping origin `agent` for mappings written through MCP.
- New admin-only MCP tools: `list_unmapped_games`, `map_external_game` and `dismiss_unmapped_game`. Only users with the `ADMIN` role can see or call them. They need a new `mappings:write` scope. They never overwrite an existing mapping, and they share the existing MCP write rate limit.

## Capabilities

### New Capabilities
- `unmapped-external-games`: the queue of external games that have no mapping, covering registration (name, owners), Xbox coverage, the paginated moderator list and dismissal.
- `mcp-mapping-tools`: admin-only MCP tools that let an agent read the unmapped queue and write or dismiss mappings, with visibility based on the user's role, a dedicated scope, a no-overwrite rule and audit via the `agent` origin.

### Modified Capabilities
- `external-game-mapping`: the mapping origin gains `agent`. This capability is introduced by the in-flight `add-epic-games-connection` change.
- `mcp-authorization`: the scope set gains `mappings:write`. This capability is introduced by the in-flight `add-mcp-server` change.

`add-epic-games-connection` and `add-mcp-server` must be archived before this change, so that the modified requirements exist in the main specs.

## Impact

- **Database**: a migration adds a nullable `name` column to `unmapped_external_game` and creates the `unmapped_external_game_owner` table (entry, user; cascades on user deletion).
- **Code**: `ExternalGameService` (registration, list, dismiss, agent mapping); `PlaytimeWatchProcessor` (Steam, PSN, Xbox, Epic); `ImporterService` (Xbox, Epic); `EpicNamespaceFillProcessor`; `EpicSyncService` (catalog title lookup); `ExternalGameController` (paginated list, dismiss endpoint); `src/mcp/*` (role-gated tool registration, new scope, three tools).
- **Steam**: owned-games requests switch to `includeAppInfo: true` so names are returned. The response is larger, but the request count stays the same.
- **Clients**: the admin site's unmapped list must read the paginated response. The OAuth consent page shows `mappings:write` when a client requests it.
- **No new dependencies.**
