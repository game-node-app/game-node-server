# Design

## Context

- `ExternalGameService.registerUnmappedGame(uid, category)` inserts one row per call and swallows `ER_DUP_ENTRY`. Callers loop over source IDs: `PlaytimeWatchProcessor` (Steam, PSN, Epic), `ImporterService` (Epic only, via `matchUnprocessed`'s `onUnmapped`) and `EpicNamespaceFillProcessor` (no user). Xbox paths never call it.
- `unmapped_external_game` has `sourceUid`, `category`, `isActive` and a unique (`sourceUid`, `category`). There is no name and no owner.
- Steam's owned-games call uses `includeAppInfo: false`, so it returns no names. PSN and Xbox list items carry names. Epic library items (`namespace`, `catalogItemId`, `appName`) do not.
- The MCP server is built per request in `McpController` from the token's `sub`. Scopes are checked per `tools/call` from `MCP_TOOL_SCOPES`, before the user is known. `AuthService.getUserRoles(userId)` already exists.
- The IGDB sync only diffs rows with `origin === "igdb"`, so `agent` rows are already preserved without code changes.

## Goals / Non-Goals

**Goals:**
- One registration path that every provider uses, carrying name and user.
- Mapping tools that reuse the existing MCP auth, write guard and rate limit.

**Non-Goals:**
- Automatic name-based matching. The agent decides, and the admin approves each call.
- An origin filter or audit UI for mappings. Auditing is a database query on `origin = 'agent'`.
- Updating the admin website. Its unmapped list must adapt to the paginated response, tracked as a follow-up in that repo.
- Backfilling names for existing entries. Names fill in on the next sync that sees each entry.

## Decisions

### Batched registration with SQL upsert
Replace `registerUnmappedGame` with `registerUnmappedGames(category, entries: { sourceUid, name? }[], userId?)`, called once per sync or import with every unmapped ID. It runs in chunks of 500:
1. `INSERT ... ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name)`. A new name replaces the old one, a missing name keeps it, and `isActive` is never touched, so mapped and dismissed entries stay inactive.
2. When `userId` is given, select the chunk's entry ids and `INSERT IGNORE` them into `unmapped_external_game_owner`.

Names are truncated to 255 characters. The method keeps `@PlayerSyncWrite()`, and callers keep `assertPlayerSyncActive()` before calling it.
*Alternative:* keep the per-ID TypeORM insert and add a follow-up update. Rejected: it needs two queries per ID, and an `orUpdate(["name"])` would overwrite names with null.

### Owners as a join table
`unmapped_external_game_owner (unmappedExternalGameId int, userId varchar(36))`. The primary key is both columns. Both are foreign keys with `ON DELETE CASCADE`, so account deletion cleans up without new code.
*Alternative:* a counter column. Rejected: it cannot avoid counting the same user twice across repeated syncs.

### Names per provider
- **Steam:** set `includeAppInfo: true` and read `item.game.name`. The recently played endpoint already returns names.
- **PSN:** the played-games item's `name`.
- **Xbox:** `XboxGameTitle.name`.
- **Epic:** a new `EpicSyncService.getCatalogTitles(accountId, namespace, catalogItemIds)` calls Epic's catalog bulk items endpoint (`/catalog/api/shared/namespace/{ns}/bulk/items`) with the user's token through `cancellableProviderCall`. It prefers the item without `mainGameItem` (the base game). It runs only for unmapped namespaces whose entry has no name yet, so steady-state syncs make no extra calls. A failure is logged and the name left empty.

### Paginated list ordered by owner count
`getUnmappedGames({ category?, limit, offset })` uses a query builder: a left join on owners, `COUNT(owner.userId) AS ownerCount`, grouped by entry, ordered by `ownerCount DESC, id ASC`, with `getCount` for the total. The controller DTO picks `limit` and `offset` from `BaseFindDto` and adds an optional `category`. The response is `PaginationResponseDto`.

### Shared service methods for REST and MCP
- `dismissUnmappedGame(id)`: `UPDATE ... WHERE id = ? AND isActive = true`. Zero affected rows means not found (404 or tool error).
- `mapUnmappedGame(id, gameId)`: loads the active entry, checks the game exists, refuses if `getExternalGamesForSourceIds([uid], category)` returns anything, then calls `insertReserved({ origin: "agent", url: storeUrl(category, uid) })` and deactivates the entry.
- `submit` updates now also set `origin: "curated"`.
- `storeUrl(category, uid)` is a small lookup in `external-game.utils.ts`: Steam `store.steampowered.com/app/{id}`, PSN `store.playstation.com/en-us/concept/{id}`, Xbox `www.xbox.com/en-US/games/store/_/{id}`. Epic returns `null`.

### Role-gated tool registration
After token verification, `McpController` reads `getUserRoles(userId)` and passes `isAdmin` to `createMcpServer`. That function registers the three mapping tools only inside `if (isAdmin)`. A tool that isn't registered is absent from `tools/list` and fails as unknown, which gives visibility and enforcement in one place. The role is read on every request, so revoking it takes effect immediately.
`MCP_TOOL_SCOPES` gains the three tools with `mappings:write`. `MCP_SCOPES` derives from it, so the metadata and consent scope list update automatically.
*Alternative:* encode admin status in a scope or token claim. Rejected: it would survive a role revocation for the token's lifetime, up to 1h.

### Tool inputs
`category` is `z.enum(["Steam", "PlaystationStoreUs", "Microsoft", "EpicGamesNamespace"])`, mapped to the enum value. The tools take the unmapped entry `id`, not a source ID and category, so "only active queue entries" is enforced by construction. Map and dismiss run through `assertCanWrite`. Their descriptions state that names are provider-supplied data and that the change affects every user.

## Risks / Trade-offs

- [Admins approve tool calls without reading them] → No-overwrite rule, the shared 10/min write limit, and the `agent` origin, so a bad batch can be found and reverted with one query.
- [Check-then-insert race: a moderator or the bulk fill maps the same ID between the check and the insert] → Same accepted shortcut as `insertReserved`'s existing comment (no unique key for non-IGDB rows). Revisit if duplicates appear.
- [Prompt injection via game names, e.g. a Steam developer naming an app with instructions] → Names are returned as data fields, never in tool descriptions. Writes stay limited to one mapping per approved call, and nothing can be overwritten.
- [Epic catalog endpoint is undocumented and may change] → A lookup failure only loses the name, and registration proceeds.
- [Steam `includeAppInfo: true` enlarges the cached owned-games payload] → Same request count. Names are short.
- [One extra role read per MCP request] → Indexed primary-key lookup on `user`. MCP traffic is low.

## Migration Plan

1. Archive `add-epic-games-connection` and `add-mcp-server` first, so the MODIFIED deltas have base specs.
2. Migration: add nullable `name varchar(255)` to `unmapped_external_game` and create `unmapped_external_game_owner` with both foreign keys. Down drops both.
3. Deploy the server. Ship the admin website change for the paginated `/unmapped` response in the same release.
4. Rollback: revert the deploy and run the down migration. `agent` mappings keep working as plain mappings. Remove them with `DELETE ... WHERE origin = 'agent'` if wanted.
