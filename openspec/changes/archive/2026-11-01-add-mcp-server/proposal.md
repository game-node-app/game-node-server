# Proposal

## Why

Users increasingly work through AI assistants (Claude.ai, ChatGPT, Claude Code, Cursor). GameNode has no way for those assistants to act on a user's behalf: login is social-only, and there are no API keys. Now that authentication runs on Better Auth, the `@better-auth/mcp` plugin can turn the API into a standards-compliant OAuth 2.1 authorization server for MCP. That lets any OAuth-capable MCP client, Claude.ai custom connectors included, connect with a "Connect GameNode" click.

## What Changes

- Enable Better Auth's MCP authorization server: `jwt()` + `@better-auth/mcp`, with client onboarding via Client ID Metadata Documents (`@better-auth/cimd`, MCP 2026-07-28 profile) and RFC 7591 dynamic client registration for clients that do not yet support CIMD.
- Publish OAuth discovery documents: authorization-server metadata and RFC 9728 protected-resource metadata for the MCP endpoint.
- Add a Streamable HTTP MCP endpoint at `/v1/mcp`, running in-process in the Nest app and calling existing services directly. Requests are authenticated with audience-bound JWT access tokens and scope checks.
- MVP tools:
  - `search_games`, `get_game`: read-only, scope `games:read`
  - `get_library_entry`, `list_collections`: read-only, scope `library:read`
  - `add_game_to_library`: write, scope `library:write`
  - `review_game`: write, scope `reviews:write`
  - `create_post`: write, scope `posts:write`
- Write tools are refused for suspended or banned users and are rate-limited per user. User-written text is accepted as plain text and stored as escaped HTML.
- Locking out a user (`AuthService.lockOut`) also revokes their OAuth refresh tokens and consents, so a banned user's MCP connection stops working.
- New database tables for the OAuth provider, JWKS, and CIMD client discovery.
- New dependencies: `@better-auth/mcp`, `@better-auth/cimd`, `@modelcontextprotocol/server`.

Out of scope for this change: image uploads, deleting or editing content, comments, follows, and the consent/login UI in `game-node-clients` (a required companion change; see Impact).

## Capabilities

### New Capabilities
- `mcp-authorization`: OAuth 2.1 authorization for MCP clients. Covers discovery metadata, client onboarding (CIMD + DCR), user consent, GameNode scopes, audience-bound tokens, and revocation on lockout.
- `mcp-tools`: the MCP endpoint and its tool surface. Covers transport, authentication challenge, per-tool scopes, input bounds, lockout and rate-limit enforcement, and output shape for the game, library, review, and post tools.

### Modified Capabilities
<!-- None: search-api and other existing specs keep their requirements; MCP tools call the same services. -->

## Impact

- **Code**:
  - `src/auth/auth.service.ts`: plugins, scopes, revocation in `lockOut`.
  - `src/main.ts`: `/.well-known/*` and `/v1/mcp` routes mounted beside the Better Auth handler, ahead of Nest's body parsers.
  - New `src/mcp/` module.
  - New TypeORM migration for the OAuth/JWKS/CIMD tables.
- **APIs**:
  - New public endpoints under `/v1/auth/oauth2/*`, `/v1/auth/jwks`, `/.well-known/oauth-authorization-server/v1/auth`, `/.well-known/oauth-protected-resource/v1/mcp`, and `/v1/mcp`.
  - Existing endpoints and cookie/bearer sessions are unchanged.
- **Config**: no new required secrets. The MCP resource URL derives from `DOMAIN_API`. The login and consent page URLs derive from `DOMAIN_WEBSITE`.
- **Companion change (game-node-clients)**: the web app must provide an OAuth consent page and make `/auth` resume the pending OAuth authorization after sign-in. Until it ships, the server side can be tested end to end only with a stub consent page.
- **Operations**: the JWKS signing keys are stored in the database. Back them up with the database; losing them invalidates every issued MCP token.
