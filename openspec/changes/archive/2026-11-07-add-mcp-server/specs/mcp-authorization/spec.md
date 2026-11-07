# Spec Delta

## Purpose

Lets third-party MCP clients (Claude.ai, ChatGPT, Claude Code, Cursor and others) obtain user-approved, scoped, revocable access to a GameNode account through standard OAuth 2.1 discovery, without API keys.

## ADDED Requirements

### Requirement: OAuth discovery metadata
The API SHALL publish RFC 8414 authorization-server metadata for the issuer `${DOMAIN_API}/v1/auth`. It SHALL also publish RFC 9728 protected-resource metadata for the MCP resource `${DOMAIN_API}/v1/mcp`, naming that issuer and the GameNode scopes. Both documents SHALL be public, unauthenticated JSON.

#### Scenario: Client discovers the authorization server from the MCP endpoint
- **WHEN** an MCP client requests `/.well-known/oauth-protected-resource/v1/mcp`
- **THEN** it receives JSON whose `resource` is `${DOMAIN_API}/v1/mcp`, whose `authorization_servers` contains the issuer, and whose `scopes_supported` lists the GameNode MCP scopes

#### Scenario: Client reads authorization-server metadata
- **WHEN** a client requests `/.well-known/oauth-authorization-server/v1/auth`
- **THEN** it receives JSON advertising the authorization, token, registration, revocation and JWKS endpoints, PKCE method `S256`, and `client_id_metadata_document_supported: true`

### Requirement: Client onboarding without pre-registration
The authorization server SHALL accept clients identified by an HTTPS Client ID Metadata Document URL, validated under the MCP 2026-07-28 profile. It SHALL also accept unauthenticated RFC 7591 dynamic registration for public clients. Metadata fetches SHALL refuse non-public addresses and redirects.

#### Scenario: CIMD client starts authorization
- **WHEN** a client starts authorization with a `client_id` that is an HTTPS URL serving valid metadata whose `redirect_uris` include the requested redirect URI
- **THEN** the authorization proceeds without any prior registration call

#### Scenario: CIMD URL points at a private address
- **WHEN** a `client_id` URL resolves to a loopback, private or link-local address
- **THEN** the server does not fetch it and the authorization fails with an OAuth error

#### Scenario: Native client registers dynamically
- **WHEN** a client posts registration metadata with a loopback `http://127.0.0.1` redirect URI and no `application_type`
- **THEN** it is registered as a native public client and receives a `client_id`

### Requirement: User sign-in and consent
Authorization SHALL require PKCE (`S256`) and a signed-in GameNode user. A user without a session SHALL be sent to the website sign-in page and returned to the pending authorization afterwards. The server SHALL show the website consent page, naming the client and requested scopes, before issuing a first grant to that client.

#### Scenario: Signed-out user connects a client
- **WHEN** a signed-out user is sent to the authorize endpoint
- **THEN** they are redirected to `${DOMAIN_WEBSITE}/auth`, and after sign-in the same authorization continues to consent

#### Scenario: User denies consent
- **WHEN** the user rejects the consent prompt
- **THEN** the client is redirected with `error=access_denied` and no tokens are issued

#### Scenario: Authorization without PKCE
- **WHEN** an authorization request omits `code_challenge`
- **THEN** the request is rejected with an OAuth error

### Requirement: GameNode scopes
The server SHALL define `games:read`, `library:read`, `library:write`, `reviews:write` and `posts:write`, alongside `openid`, `profile` and `offline_access`. Issued tokens SHALL carry only scopes the user approved.

#### Scenario: User approves a subset
- **WHEN** a client requests `games:read posts:write` and the user approves
- **THEN** the issued access token's `scope` claim contains exactly the approved scopes

### Requirement: Audience-bound access tokens
Access tokens issued for MCP SHALL be signed JWTs whose audience is `${DOMAIN_API}/v1/mcp`, verifiable with the published JWKS. They SHALL expire after at most one hour. Refresh tokens SHALL be issued only when `offline_access` is granted, and SHALL rotate on use.

#### Scenario: Token presented to the MCP endpoint
- **WHEN** a client exchanges an authorization code requested for resource `${DOMAIN_API}/v1/mcp`
- **THEN** the access token's `aud` is that resource and its `sub` is the GameNode user id

#### Scenario: Refresh token reuse after rotation
- **WHEN** a rotated refresh token is presented again later than the reuse grace window
- **THEN** the request fails with `invalid_grant`

### Requirement: Revocation on account lockout
When a user is suspended or banned, the system SHALL revoke that user's OAuth refresh tokens and consents. MCP access SHALL stop no later than the moment of lockout, and refresh tokens SHALL no longer work.

#### Scenario: Banned user's client refreshes
- **WHEN** a user is banned and their MCP client later uses its refresh token
- **THEN** the token request fails with `invalid_grant`

#### Scenario: Banned user's unexpired access token
- **WHEN** a banned user's client calls a write tool with a still-valid access token
- **THEN** the call is refused as described in the `mcp-tools` capability

### Requirement: Existing sessions unaffected
Enabling the authorization server SHALL NOT change cookie or bearer session behavior for the website, mobile and admin clients. OAuth access tokens SHALL NOT be accepted as sessions by the REST API.

#### Scenario: OAuth access token used on a REST endpoint
- **WHEN** a client sends an MCP access token as `Authorization: Bearer` to an authenticated REST endpoint such as `POST /v1/reviews`
- **THEN** the request is rejected with HTTP 401
