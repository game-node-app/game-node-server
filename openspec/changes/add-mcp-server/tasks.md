# Tasks

## 1. Dependencies and schema

- [x] 1.1 Add exact-pinned `@better-auth/mcp@1.7.14` and `@better-auth/cimd@1.7.14` (matching `better-auth`), `@modelcontextprotocol/server` and `@modelcontextprotocol/node` (same 2.x major), and an explicit `zod` matching the installed v4; verify `yarn install` succeeds and `yarn build` still passes.
- [x] 1.2 Create a migration for the `jwt`, `mcp` (OAuth provider) and `cimd` plugin tables, deriving columns from the installed plugin schemas (`auth.$context` → `getAuthTables`) in the style of `1793700000000-ReplaceSupertokensWithBetterAuth.ts`; verify `yarn migration:run` and the `down` migration on a local DB, and that the created tables match the plugin schema field-for-field.

## 2. Authorization server (mcp-authorization)

- [x] 2.1 Register `jwt()`, `mcp({...})` and `cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" })` in `AuthService` per design D1 (resource, login and consent URLs derived from `DOMAIN_API` and `DOMAIN_WEBSITE`, GameNode scopes, unauthenticated DCR with `"infer"`); verify that the existing `auth.integration.spec.ts` passes unchanged.
- [ ] 2.2 Mount `/.well-known/oauth-authorization-server/v1/auth`, `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/v1/mcp` on the raw Express app in `main.ts` (design D3); verify with an integration test asserting `resource`, `authorization_servers`, `scopes_supported`, `S256` and `client_id_metadata_document_supported`.
- [ ] 2.3 Extend `auth.integration.spec.ts` with the OAuth flow: DCR of a loopback public client, authorize without PKCE rejected, authorize while signed out redirects to `${DOMAIN_WEBSITE}/auth`, consent accept issues a code, token exchange returns a JWT with `aud` = MCP resource, `sub` = user id and only the approved scopes, and refresh rotation works; verify that the spec passes.
- [ ] 2.4 Add a test that a CIMD `client_id` resolving to a private address is refused without a fetch, and that an MCP access token sent to an authenticated REST route returns 401; verify that the test passes.
- [ ] 2.5 Make `AuthService.lockOut` delete the user's OAuth refresh tokens and consents alongside sessions (design D6); verify with an integration test that a banned user's refresh fails with `invalid_grant`.

## 3. Shared service fixes

- [ ] 3.1 Reject collection ids not owned by the caller in `CollectionsEntriesService.createOrUpdate` (HTTP 403), and confirm the REST controller is the only caller; verify with a spec covering own collections (ok), a foreign collection (403, entry unchanged) and an empty list.

## 4. MCP endpoint (mcp-tools)

- [ ] 4.1 Create `src/mcp/` (`McpModule`, `McpController` for `POST /v1/mcp` with `GET`/`DELETE` returning 405, stateless SDK transport over raw `req`/`res`), importing the service modules listed in design Context, and register it in `AppModule`; verify that the app boots and `initialize` with a valid token succeeds.
- [ ] 4.2 Implement the MCP auth guard (design D5): JWT verification for issuer and audience, a 401 with the RFC 9728 `WWW-Authenticate` challenge, a `tools/call` → scope map with a 403 `insufficient_scope` response, and `sub` as the acting user; verify with controller tests for a missing token, a wrong audience, an expired token, a missing scope and a valid token.
- [ ] 4.3 Implement the write guard `assertCanWrite(userId)` (lockout via `getLockoutStates`, 10 per 60 s per-user counter in the throttler Redis storage) and the plain-text → `<p>` HTML helper (design D6, D9); verify with unit tests covering suspended, banned and ok users, the 11th call refused, escaping of `<img onerror>`, and the paragraph/`<br>` cases from the spec.

## 5. Tools (mcp-tools)

- [ ] 5.1 Implement `search_games` and `get_game` with compact output (design D10) and `readOnlyHint: true`; verify with tool tests: bounded `limit` and `query`, platform ids present in `get_game`, and a not-found error for an unknown id.
- [ ] 5.2 Implement `get_library_entry` and `list_collections`; verify with tool tests covering an entry present, an entry absent, and that only the token user's collections are returned.
- [ ] 5.3 Implement `add_game_to_library` (merge with the existing entry, platform ids checked against the game's platforms, collection union) per design D7; verify with tool tests: new entry, existing entry keeps its collections, invalid platform, foreign collection, and a locked-out user refused.
- [ ] 5.4 Implement `review_game` with the `overwrite` guard inside the tool only (design D8: no change to `ReviewsService` or `ReviewsController`) and escaped content; verify with tool tests (first review created; game not in library → `add_game_to_library` error; existing review returned unchanged without `overwrite`; rating-only `overwrite: true` keeps the old content; rating 7 rejected), and verify with a controller test that a second `POST /v1/reviews` for the same game still updates in place.
- [ ] 5.5 Implement `create_post` with escaped content and a game-exists check; verify with tool tests that the post is created and an activity is registered, an unknown game is rejected, and a missing `posts:write` scope returns 403.
- [ ] 5.6 Verify that `tools/list` returns all seven tools with JSON Schemas and the `readOnlyHint` values from the spec (test).

## 6. Docs and integration

- [ ] 6.1 Document the MCP server in README: endpoint URL, discovery URLs, scopes, how to add it as a Claude.ai custom connector and in Claude Code (`claude mcp add --transport http`), and the dependency on the website consent page; regenerate `server_swagger.json`; verify that the README commands are accurate against a local run.
- [ ] 6.2 End-to-end check against a local or staging stack with a stub consent page: connect MCP Inspector via OAuth, run every tool, ban the user, and confirm that writes fail immediately and refresh fails; then run `yarn test` and `yarn build` with no failures.

## Workflow follow-up

- Companion change in `game-node-clients`: add the `/oauth/consent` page (client name, URI, verified CIMD domain, requested scopes, accept/deny via the Better Auth OAuth client) and make `/auth` resume a pending OAuth authorization after sign-in.
- Archive this change after review and after the Claude.ai connector is verified in production.
