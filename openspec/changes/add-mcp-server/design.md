# Design

## Context

See proposal.md for the motivation and specs/ for the required behavior.

- **Better Auth 1.7.14** runs in-process (`AuthService.auth`). Its handler is mounted on the raw Express instance at `/v1/auth/*splat` in `main.ts`, before Nest's JSON/urlencoded parsers, because Better Auth reads the raw body. Plugins today are `bearer()`, `capacitor()` and `admin()`. Sign-in is social-only (Google, Discord, Twitter).
- **Lockout** (`AuthService.lockOut`) sets the admin plugin's `banned` fields and deletes sessions. Enforcement elsewhere uses `AuthService.getLockoutStates`.
- **Runtime**: Node 24, TypeScript `module: NodeNext`, so the ESM-only `@better-auth/*` packages load as `better-auth` already does.
- **Schema**: Better Auth tables are created by hand-written TypeORM migrations (`1793700000000-ReplaceSupertokensWithBetterAuth.ts`), not by the Better Auth CLI.
- **Website**: `game-node-clients/apps/web` has `/auth` (sign-in) but no consent page.
- **Services to reuse** (all exported by their modules): `SearchService`, `GameRepositoryService`, `CollectionsService`, `CollectionsEntriesService`, `ReviewsService`, `PostsService`. A global Redis-backed `ThrottlerModule` exists.
- **Existing gap**: `CollectionsEntriesService.createOrUpdate` does not check that `collectionIds` belong to the caller (it reaches `updateAssociatedCollections` directly). It also *replaces* an entry's collection set instead of adding to it.

## Goals / Non-Goals

**Goals:**
- Claude.ai and other OAuth MCP clients connect with no manual client setup.
- Tools reuse existing services, so MCP writes have the same side effects (activities, statistics, achievements, notifications) as website writes.
- No change to existing session-based auth for website, mobile and admin.

**Non-Goals:**
- MCP resources, prompts, sampling, or server-to-client streaming (tools only, stateless).
- Accepting OAuth access tokens on the REST API.
- A "connected apps" management UI. Revocation through the OAuth revocation endpoint and lockout is enough for the MVP.
- Rich text or markdown in tool content.

## Decisions

### D1. Use `@better-auth/mcp` (`mcp()`), not `oauthProvider()` directly
`mcp()` is `oauthProvider()` preconfigured for MCP:
- issued tokens are audience-bound to the `resource`;
- new clients are linked to that resource;
- it serves RFC 9728 metadata;
- refresh-token retries get a 30 s reuse window, which MCP clients need.

The two plugins cannot be combined, and nothing else needs a general OAuth provider. Configuration:

```ts
jwt(),
mcp({
  resource: `${DOMAIN_API}/v1/mcp`,
  loginPage: `${DOMAIN_WEBSITE}/auth`,
  consentPage: `${DOMAIN_WEBSITE}/oauth/consent`,
  scopes: ["openid", "profile", "offline_access", "games:read", "library:read",
           "library:write", "reviews:write", "posts:write"],
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  clientRegistrationDefaultApplicationType: "infer",
}),
cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
```

- **`email` is left out** of scopes: no tool needs it, and it is the most sensitive profile claim.
- **`fetchClientMetadataResource` comes from `@better-auth/cimd/node`.** It resolves DNS once, rejects non-public addresses, pins the connection and refuses redirects. That is exactly the SSRF guard the spec requires, so nothing is hand-rolled.
- **Alternative considered: CIMD only, without DCR.** Rejected: CIMD is the MCP 2026-07-28 default, but Cursor and older Claude Code releases still register dynamically. DCR is restricted to public clients with loopback, custom-scheme or HTTPS redirects (the `"infer"` policy).

### D2. The `jwt()` plugin is added for signed access tokens
MCP needs JWT access tokens that can be verified locally (`/v1/auth/jwks`).
- **Side effects**: a `jwks` table, plus a `set-auth-jwt` response header on `get-session`. Existing clients ignore that header, and `bearer()` keeps validating opaque session tokens only.
- **Why this keeps the REST API closed to OAuth tokens**: a JWT presented to `AuthGuard` is not a session token, so it is rejected with 401.

### D3. Discovery routes are mounted on the raw Express app in `main.ts`
RFC 8414 / RFC 9728 put well-known paths at the host root, with the issuer or resource path appended:
- `/.well-known/oauth-authorization-server/v1/auth`
- `/.well-known/oauth-protected-resource/v1/mcp`

Better Auth only routes under `/v1/auth`, and Nest's URI versioning would prefix `/v1`. So both routes go next to the existing auth mount and return the documents from `oauthProviderAuthServerMetadata(auth)` and the MCP plugin's protected-resource metadata. Plain `/.well-known/oauth-authorization-server` is also served, because some clients ignore path insertion.

### D4. The MCP endpoint is a Nest module (`src/mcp/`) using the official SDK in stateless mode
- **Packages**: `@modelcontextprotocol/server` with the Node transport (`@modelcontextprotocol/node`), v2.x, the same major version `@better-auth/mcp` is tested against.
- **Per request**: `McpController` (`POST /v1/mcp`, plus `GET`/`DELETE` → 405 because the server is stateless) authenticates, builds a `McpServer` with the tools, and hands the raw `req`/`res` to a stateless transport.
- **Validation**: the SDK validates tool input with zod (v4, already installed transitively).
- **Why stateless**: there is no session store to scale or expire, and a tools-only server gains nothing from sessions.
- **Alternative considered: a separate MCP service calling the REST API.** Rejected: REST would have to accept OAuth tokens, adding a hop and duplicating auth (spec: existing sessions unaffected).

### D5. Authentication and scopes in `McpAuthGuard`
1. Verify the bearer JWT with Better Auth's resource-server verifier against the local JWKS (`better-auth/oauth2` `verifyAccessToken`, or `@better-auth/mcp` helpers if they expose a Node-friendly form), checking issuer `${DOMAIN_API}/v1/auth` and audience `${DOMAIN_API}/v1/mcp`.
2. On failure, return 401 with the RFC 9728 challenge (`createResourceServerChallenge`).
3. For `tools/call`, read `params.name` from the already-parsed JSON-RPC body, map it to its required scope (one constant map next to the tool definitions), and return 403 `insufficient_scope` before dispatch.

Doing the scope check at the HTTP layer, not inside the tool, is what lets clients step up authorization (spec: Per-tool scopes). `sub` becomes the acting `userId`. No tool schema has a user field.

### D6. Write tools go through one guarded helper
Before the service call, every write tool runs `assertCanWrite(userId)`:
1. `AuthService.getLockoutStates([userId])` → error result if suspended or banned. This covers access tokens still valid after a lockout (≤ 1 h).
2. A per-user counter in the existing throttler Redis storage (key `mcp:write:<userId>`, 10 / 60 s) → error result with the retry time.

Lockout also revokes tokens. `AuthService.lockOut` deletes the user's rows in the OAuth refresh-token and consent tables through `ctx.adapter` (the same way it already deletes sessions), so refresh fails with `invalid_grant`.

### D7. Library writes: fix ownership in the shared service, merge in the tool
- **Ownership**: `CollectionsEntriesService.createOrUpdate` will reject collection ids not owned by `userId` (403). This fixes the IDOR for REST and MCP alike.
- **Callers**: the REST controller is its only caller (imports use `createForImport`/`createMissingForBatch`).
- **Merging**: `add_game_to_library` loads the existing entry. It unions `collection_ids` with the current collections, and uses the current platforms when `platform_ids` is omitted on an update. It then calls `createOrUpdate`, so the service's replace semantics never drop collections.
- **Platform check**: platform ids are checked against the game's `platforms` relation.

### D8. Reviews: explicit overwrite
`ReviewsService.createOrUpdate` upserts, and the web and mobile clients depend on that. `GameInfoReviewEditorView` and the quick review in `CollectionEntryEditForm` (`game-node-clients/packages/ui`) both call `POST /v1/reviews` for create *and* edit.

**`ReviewsService` and `ReviewsController` are not modified.** The guard lives only in the tool:
1. It looks up the user's review with `findOneByUserIdAndGameId`.
2. When a review exists and `overwrite` is false, it returns that review instead of writing.
3. Otherwise it calls the unchanged `createOrUpdate`.

On the website, the editor shows the existing review before the user saves. An assistant has no such view, so this guard is what stops it from silently replacing a review.

Behavior inherited from the service:
- It requires a library entry (`findOneByUserIdAndGameIdOrFail`). The tool turns that failure into a "use `add_game_to_library` first" error.
- An update merges the input into the existing row, so `overwrite` without `content` keeps the old text, as on the website.

### D9. Plain text → escaped `<p>` HTML
A ~10-line helper in `src/mcp/`:
1. escape `& < > " '`;
2. split on blank lines;
3. wrap each paragraph in `<p>`, turning single newlines into `<br>`.

Stored content then matches what the website editor produces and can never carry markup.
- **Alternative considered: accept markdown and sanitize with `sanitize-html` (installed).** Rejected for the MVP: it needs a markdown parser dependency, and its output is harder to reason about.

### D10. Compact tool output
`get_game` loads only `cover`, `genres` and `platforms` (plus the review score from `ReviewsService`). It returns a flat object, both as `structuredContent` and as a JSON text block, so full IGDB rows never reach the model's context. `search_games` maps the search response the same way.

## Risks / Trade-offs

- **[Risk] Unauthenticated DCR invites registration spam.** → It only accepts public clients, the clients are inert until a user consents, and the existing global throttler covers `/v1/auth/oauth2/register`. Periodic cleanup of never-used clients is possible later.
- **[Risk] A consent-phishing client could impersonate a known brand.** → The consent page must show the client's name, URI and, for CIMD clients, the verified `client_id` domain. This is a companion requirement on the website change.
- **[Risk] A suspended user keeps read access until their access token expires (≤ 1 h).** → Accepted. Writes are blocked immediately, and refresh is revoked.
- **[Risk] Prompt-injected content could get the assistant to post on the user's behalf.** → `readOnlyHint: false` makes clients confirm, writes are rate-limited, and content is escaped, so the worst case is unwanted plain text the user can delete.
- **[Risk] Better Auth's OAuth/MCP plugins are young (1.7.x) and their exact table schema and route paths may shift.** → Pin exact versions, as `better-auth` already is. Generate the migration SQL from the installed plugin schema, and cover discovery and the token flow with an integration test.
- **[Trade-off] The MCP endpoint lives in the API process**, so a misbehaving agent's reads compete with website traffic. → Read tools are bounded (search limit ≤ 20, compact game reads). The endpoint can move to its own deployment later without changing the protocol.

## Migration Plan

1. Ship the migration that creates the OAuth provider, JWKS and CIMD tables (run before the app starts, as existing migrations are).
2. Deploy the server. With no consent page yet, discovery works and authorization reaches a 404 consent page, so nothing user-facing changes.
3. Ship the `game-node-clients` consent page and `/auth` resume handling.
4. Verify end to end with the MCP Inspector and a Claude.ai custom connector against staging.
5. **Rollback**: remove the `mcp`/`cimd`/`jwt` plugins and the `/v1/mcp` and `/.well-known` routes. The new tables can stay; existing sessions are unaffected.

## Open Questions

- Exact consent-page route on the website (`/oauth/consent` is assumed). This only changes one config string.
- Whether to show "connected apps" in account settings in a follow-up change.
