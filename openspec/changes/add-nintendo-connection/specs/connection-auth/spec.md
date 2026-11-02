# Spec Delta

## MODIFIED Requirements

### Requirement: Mode-enforced connection onboarding
The system SHALL enforce each provider's declared authentication mode (`redirect`, `public_identifier`, or `delegated_code`). Redirect providers (`steam`, `xbox`) and delegated-code providers (`epicgames`, `nintendo`) SHALL only be linked via the init/callback endpoints and SHALL reject manual `POST /v1/connections` requests with HTTP 400. Public-identifier providers (`psn`) SHALL only be linked via `POST /v1/connections` and SHALL reject init/callback requests with HTTP 400.

#### Scenario: Manual identifier submitted for Steam or Xbox
- **WHEN** an authenticated user submits `POST /v1/connections` with `type` set to `steam` or `xbox`
- **THEN** the server rejects the request with HTTP 400 without querying the upstream provider or modifying any existing connection

#### Scenario: Manual identifier submitted for Epic Games
- **WHEN** an authenticated user submits `POST /v1/connections` with `type` set to `epicgames`
- **THEN** the server rejects the request with HTTP 400 without querying Epic or modifying any existing connection

#### Scenario: Manual identifier submitted for Nintendo
- **WHEN** an authenticated user submits `POST /v1/connections` with `type` set to `nintendo`
- **THEN** the server rejects the request with HTTP 400 without querying Nintendo or modifying any existing connection

#### Scenario: Redirect flow initiated for PSN
- **WHEN** an authenticated user requests `POST /v1/connections/psn/auth/init`
- **THEN** the server rejects the request with HTTP 400 indicating `psn` does not support redirect authentication

#### Scenario: PSN public identifier onboarding
- **WHEN** an authenticated user submits `POST /v1/connections` with `type: "psn"` and a valid `userIdentifier`
- **THEN** the server resolves the PSN account ID and online ID, persists the `UserConnection` with `authStatus: "connected"`, initializes synchronization state, and schedules initial synchronization

#### Scenario: Delegated-code onboarding
- **WHEN** an authenticated user calls `POST /v1/connections/epicgames/auth/init`, signs in at the returned URL in another tab, and submits the displayed code as `callbackParams.code` to `POST /v1/connections/epicgames/auth/callback` with the returned `state`
- **THEN** the server exchanges the code with the provider, persists the `UserConnection` and its encrypted credentials with `authStatus: "connected"`, initializes synchronization state, and schedules initial synchronization

#### Scenario: Delegated-link onboarding for Nintendo
- **WHEN** an authenticated user calls `POST /v1/connections/nintendo/auth/init`, signs in at the returned URL in another tab, copies the "Select this account" link and submits it as `callbackParams.code` to `POST /v1/connections/nintendo/auth/callback` with the returned `state`
- **THEN** the server exchanges the link's code with Nintendo, persists the `UserConnection` and its encrypted credentials with `authStatus: "connected"`, initializes synchronization state, and schedules initial synchronization

### Requirement: Re-authentication notification
When a connection moves from `connected` to `reauth_required`, the system SHALL append a `connection.reauth-required` notification intent for the connection owner in the same transaction, at most once per transition. The inbox item SHALL be ungrouped, target the connection and its provider, and carry plain preview text naming the provider.

#### Scenario: Grant revoked during a background sync
- **WHEN** an Epic, Xbox or Nintendo token refresh fails because the grant is revoked, expired or missing
- **THEN** the connection becomes `reauth_required` and the owner gets one `connection.reauth-required` notification whose target is `{ type: "connection", id, provider }` and whose preview text names the provider

#### Scenario: Already reauth_required
- **WHEN** a sync or a concurrent refresh runs against a connection that is already `reauth_required`
- **THEN** no new notification is created

#### Scenario: Reconnect, then lose auth again
- **WHEN** the user reconnects and the provider grant is later revoked again
- **THEN** a new `connection.reauth-required` notification is created

#### Scenario: Connection deleted before projection
- **WHEN** the connection no longer exists when the notification is projected
- **THEN** the notification is suppressed
