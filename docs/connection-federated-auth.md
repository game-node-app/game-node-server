# Federated Connection Authentication & Lifecycle Contract

## Overview

GameNode supports multi-platform gaming service connections (`steam`, `psn`, `xbox`) using mode-specific authentication pipelines:
- **Steam**: OpenID 2.0 federated redirect authentication with server-side signature verification (`check_authentication`).
- **Xbox**: Microsoft OAuth 2.0 authorization code grant (`Xboxlive.signin`, `Xboxlive.offline_access`), multi-tier exchange (MS OAuth &rarr; XBL User Token &rarr; XSTS Token), per-user encrypted token rotation with Redis refresh locks, and catalog credential isolation.
- **PlayStation Network (PSN)**: Direct public identifier resolution (`onlineId` / PSN Account ID) via `POST /v1/connections`.

---

## Environment Variables

| Variable | Type | Description |
|---|---|---|
| `CONNECTION_CREDENTIAL_ENCRYPTION_KEY` | String (Required at startup) | 32-byte cryptographic key for AES-256-GCM encryption of stored credentials in `user_connection_credential`. Accepted formats: 64 hexadecimal characters, 44 Base64 characters, or a 32-byte raw UTF-8 string. Validated on startup by `ConnectionCredentialCryptoService`. |
| `XBOX_OAUTH_CLIENT_ID` | String | Microsoft Entra / Azure App Registration Client ID with permissions `Xboxlive.signin` and `Xboxlive.offline_access`. |
| `XBOX_OAUTH_CLIENT_SECRET` | String | Microsoft OAuth 2.0 Client Secret corresponding to the application. |
| `XBOX_OAUTH_REDIRECT_URI` | String (URL) | Microsoft OAuth registered redirect URI pointing to the frontend callback route (e.g., `https://gamenode.app/connections/callback/xbox` or `http://localhost:3000/connections/callback/xbox`). |
| `STEAM_API_KEY` | String | Steam Web API key for server-to-server profile summaries and library/achievement sync. |
| `PSN_NPSSO_KEY` | String | PlayStation Network NPSSO token for PlayStation API access. |
| `XBOX_API_USER` / `XBOX_API_PASS` | String | Fallback credentials for catalog-level unauthenticated Xbox operations (`XboxSyncAuthService.getCatalogAuthCredentials`). |

---

## Frontend Integration & Redirect Callback Contract

### 1. Connection Mode Discovery

Frontend clients query available connections:
```http
GET /v1/connections
```

Response payload includes the declarative `authMode`:
```json
[
  {
    "type": "steam",
    "name": "steam",
    "authMode": "redirect",
    "isImporterViable": true
  },
  {
    "type": "xbox",
    "name": "xbox",
    "authMode": "redirect",
    "isImporterViable": true
  },
  {
    "type": "psn",
    "name": "psn",
    "authMode": "public_identifier",
    "isImporterViable": true
  }
]
```

---

### 2. Redirect Flow (Steam & Xbox)

For providers with `authMode: "redirect"`, manual submission to `POST /v1/connections` is rejected with HTTP 400. Clients must follow the two-step handshake:

#### Step 2A: Initialize Authentication
```http
POST /v1/connections/:type/auth/init
Content-Type: application/json
Authorization: Bearer <session-or-jwt>

{
  "isAutoImportEnabled": true,
  "autoImportCollectionId": "optional-uuid"
}
```

Response:
```json
{
  "authorizationUrl": "https://...",
  "state": "random-anti-csrf-token"
}
```
- The backend generates a cryptographically random `state` token stored in Redis with a 10-minute TTL, bound to the initiating GameNode `userId`, connection `type`, and auto-import preferences.
- The client navigates the browser to `authorizationUrl`.

#### Step 2B: Frontend Callback Handshake

When the external provider redirects back to the frontend:

##### Steam OpenID 2.0 Callback:
Steam redirects to the return URL with standard OpenID query parameters (`openid.ns`, `openid.mode`, `openid.claimed_id`, `openid.identity`, `openid.sig`, etc.).

The frontend extracts query parameters and posts them:
```http
POST /v1/connections/steam/auth/callback
Content-Type: application/json
Authorization: Bearer <session-or-jwt>

{
  "state": "<state-param-from-redirect>",
  "callbackParams": {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000",
    "openid.identity": "https://steamcommunity.com/openid/id/76561198000000000",
    "openid.sig": "...",
    "...": "..."
  }
}
```
- Steam OpenID verifies ownership; Steam game details must still be public for library and achievement synchronization.
- Backend posts a server-to-server `check_authentication` request to Steam to cryptographically verify validity (`is_valid:true`).
- Upon success, extracts the 64-bit Steam ID, queries Steam user summary for the nickname, persists the connection with `authStatus: "connected"`, and schedules initial sync.

##### Xbox Microsoft OAuth 2.0 Callback:
Microsoft redirects to the registered `XBOX_OAUTH_REDIRECT_URI` with `?code=...&state=...`.

The frontend submits:
```http
POST /v1/connections/xbox/auth/callback
Content-Type: application/json
Authorization: Bearer <session-or-jwt>

{
  "state": "<state-param-from-redirect>",
  "callbackParams": {
    "code": "<authorization-code-from-microsoft>"
  }
}
```
- Backend exchanges the code for Microsoft tokens (`access_token`, `refresh_token`), exchanges for XBL User Token, and requests an XSTS Token for `http://xboxlive.com`.
- Extracts the user's `xuid`, `gamertag`, and `userHash` directly from XSTS display claims.
- Encrypts tokens at rest in `user_connection_credential` via AES-256-GCM.
- Persists the connection with `authStatus: "connected"` and schedules initial sync.

---

### 3. Public Identifier Flow (PSN)

For providers with `authMode: "public_identifier"`, onboarding continues via:
```http
POST /v1/connections
Content-Type: application/json
Authorization: Bearer <session-or-jwt>

{
  "type": "psn",
  "userIdentifier": "psnOnlineId",
  "isAutoImportEnabled": true,
  "autoImportCollectionId": "optional-uuid"
}
```

---

### 4. Connection Settings Updates

Users can update auto-import preferences on existing connections without re-authenticating:
```http
PATCH /v1/connections/:id
Content-Type: application/json
Authorization: Bearer <session-or-jwt>

{
  "isAutoImportEnabled": true,
  "autoImportCollectionId": "target-collection-uuid"
}
```
- Preserves existing credentials and sync cooldowns.
- Validates collection ownership when `autoImportCollectionId` is specified.
- The same update is available at `PATCH /v1/connections/own/:type/settings`.

---

### 5. Credential Lifecycle & Re-Authentication (`reauth_required`)

- `UserConnectionDto` exposes `authStatus: "connected" | "reauth_required"`.
- When an Xbox token refresh fails upstream with `invalid_grant` (e.g. user revoked permission in Microsoft account settings), the background sync pipeline:
  1. Sets `UserConnection.authStatus = "reauth_required"`.
  2. Records an unretryable `reauth_required` failure outcome on `PlayerConnectionSync`.
  3. Skips the connection during future scheduled sync cycles.
- The frontend should present a "Reconnect" button when `authStatus === "reauth_required"`, which initiates the redirect flow (`POST /v1/connections/:type/auth/init`).
- Completing the callback resets `authStatus` to `"connected"` and immediately resumes sync eligibility.
