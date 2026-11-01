# Tasks

## 1. Schema

- [x] 1.1 Add a migration that adds nullable `name varchar(255)` to `unmapped_external_game` and creates `unmapped_external_game_owner` (`unmappedExternalGameId` int, `userId` varchar(36), composite PK, both FKs `ON DELETE CASCADE`), with a down that drops both; verify `migration:run` then `migration:revert` succeed on a local database
- [x] 1.2 Add `name` to `UnmappedExternalGame`, add an `UnmappedExternalGameOwner` entity and register it in `ExternalGameModule`; verify the app boots and `migration:generate` reports no pending changes

## 2. Registration with name and owners

- [x] 2.1 Replace `registerUnmappedGame` with `registerUnmappedGames(category, entries, userId?)` in `ExternalGameService` (500-row chunks, `ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name)`, `INSERT IGNORE` owners, names truncated to 255, keeps `@PlayerSyncWrite()`); verify with an integration test against the real database covering: new entry with name, name replaced, name kept on nameless re-registration, inactive entry stays inactive, same user counted once, user deletion removes owner
- [x] 2.2 Switch Steam owned games to `includeAppInfo: true` and pass `game.name`; register Steam unmapped apps once per sync in `PlaytimeWatchProcessor` and in the Steam importer path via `onUnmapped`; verify `playtime-watch.processor.spec.ts` and `importer.service.spec.ts` assert one batched call with names and the user id
- [x] 2.3 Do the same for PSN (concept id + played-game `name`) in playtime watch and the PSN importer path; verify the PSN cases in the same spec files
- [x] 2.4 Register Xbox unmapped product IDs with `XboxGameTitle.name` in playtime watch and the Xbox importer path; verify new spec cases that an unmatched Xbox title is registered and a matched one is not
- [ ] 2.5 Add `EpicSyncService.getCatalogTitles` (catalog bulk items with the user's token, prefers the item without `mainGameItem`, errors logged and returned as no title); confirm the endpoint and `title` field against a real Epic account; verify `epic-sync.service.spec.ts` covers base-game preference and failure
- [x] 2.6 Use it in Epic playtime watch and the Epic importer only for unmapped namespaces whose entry has no name, then register with names; verify spec cases that named entries trigger no catalog call and a lookup failure still registers the namespace
- [x] 2.7 Move `EpicNamespaceFillProcessor` to `registerUnmappedGames` with no user and no name; verify `epic-namespace-fill.processor.spec.ts` still passes with the ambiguous case asserting the new call

## 3. Moderator list and dismiss

- [x] 3.1 Implement paginated `getUnmappedGames({ category?, limit, offset })` ordered by owner count desc then id, returning id, source ID, category, name and owner count; add a request DTO (`limit`, `offset`, optional `category`) and response DTO; verify an integration test for ordering and the category filter, and a controller spec for the role guard
- [x] 3.2 Add `dismissUnmappedGame(id)` and `POST /v1/game/external/unmapped/:id/dismiss` (`MOD`, `ADMIN`; 404 when unknown or inactive); verify service and controller specs, including that re-registration keeps a dismissed entry inactive
- [x] 3.3 Regenerate `server_swagger.json`; verify the unmapped list and dismiss endpoint appear with the new shapes

## 4. Mapping origin and agent mapping

- [x] 4.1 Add `"agent"` to `GameExternalGame.origin` and update its doc comment; make `submit` set `origin: "curated"` when it updates an existing row; verify an `external-game.service.spec.ts` case where correcting an `agent` row leaves it `curated` with the same id
- [x] 4.2 Add `storeUrl(category, uid)` to `external-game.utils.ts` (Steam, PSN, Xbox; `null` otherwise); verify a small unit test per category
- [x] 4.3 Add `mapUnmappedGame(id, gameId)` (active entry only, game must exist, refuses when any mapping exists, inserts `origin: "agent"` with `storeUrl`, deactivates the entry); verify service specs for success, inactive entry, unknown game, and existing mapping leaving the entry active

## 5. MCP mapping tools

- [x] 5.1 Add the three tools to `MCP_TOOL_SCOPES` with `mappings:write`; verify the protected-resource metadata and `MCP_SCOPES` include it (existing metadata spec)
- [x] 5.2 In `McpController`, look up `getUserRoles(userId)` and pass `isAdmin` to `createMcpServer`, which registers the mapping tools only for admins; verify `mcp.controller.spec.ts` cases: admin `tools/list` includes them, non-admin omits them, non-admin call with the scope fails as unknown tool
- [x] 5.3 Implement `listUnmappedGames`, `mapExternalGame` and `dismissUnmappedGame` in `McpToolsService` (map and dismiss through `assertCanWrite`; category as enum name; entries include `storeUrl`; refusals as tool errors); verify `mcp-tools.service.spec.ts` covers listing, mapping, refusal on an existing mapping, dismissal and the write limit
- [x] 5.4 Document `mappings:write` and the admin tools in the README's MCP section; verify the README lists all MCP scopes

## 6. Integration check

- [ ] 6.1 Run `npm run lint`, `npm test` and the integration suite; verify all pass
- [ ] 6.2 Against a local stack, connect an admin MCP client with `mappings:write`, list unmapped games, map one and dismiss one; verify the mapping row has `origin = 'agent'`, both entries are inactive, and a non-admin client does not see the tools

## Workflow follow-up

- Update the admin website's unmapped list for the paginated response and add a dismiss action (separate repo).
- Check that the website's OAuth consent page labels `mappings:write`.
- Archive `add-epic-games-connection` and `add-mcp-server` before archiving this change.
