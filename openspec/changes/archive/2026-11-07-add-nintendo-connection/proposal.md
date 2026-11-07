# Proposal

## Why

Nintendo is the most requested platform we don't support, and Nintendo players can't bring their games into GameNode today. Nintendo has no public API. Since November 2025, though, the Nintendo Store app's Play Activity screen has been backed by a per-account play-history endpoint, and a spike against a real account showed we can link an account and refresh access from our servers. The Epic change already built the parts this needs: delegated-code onboarding, GameNode-owned mappings, the shared importer matching and the unmapped curation queue with agent mapping tools.

## What Changes

- **Nintendo connection** (`type: "nintendo"`, `authMode: "delegated_code"`):
  - **Linking.** The user signs in to their Nintendo Account through the Nintendo Store app's login (PKCE). They copy the "Select this account" link and paste it back. The existing `auth/init` and `auth/callback` endpoints carry it, and the pasted link travels in `callbackParams.code` as Epic's code does.
  - **Credentials.** The Nintendo session token (valid for 730 days, never rotated) is stored encrypted. A short-lived access token is derived from it per sync. A rejected session token moves the connection to `reauth_required` and notifies the owner.
- **Library import and auto-import** from the account's play history. Only Switch (`HAC`) and Switch 2 (`BEE`) entries are imported, on the matching platform. Titles the user hid in Nintendo's app are never imported.
- **Playtime import** from the same play history: total minutes plus the real first-played and last-played dates, per game and platform.
- **New GameNode-only mapping category** `NintendoTitleId` (1002), keyed by the 16-hex Switch title ID. There is no bulk seed: unmapped titles register with their Nintendo title name, and admins map them through the existing curation endpoints and MCP tools. The MCP mapping tools accept the new category.
- **Response validation at the trust boundary.** The play-history entry shape is documented by community code but has not been seen live with data. A response without the fields we need fails the sync with a logged, redacted shape sample and never imports partial or guessed data.
- **Provider name and enum updates:** importer source, playtime source mapping, notification provider enums and the re-auth notification provider name gain `nintendo`.
- **Out of scope:**
  - 3DS and Wii U history
  - games owned but never played (play history has none)
  - achievements
  - a bulk mapping fill
  - automatic title-name matching
  - client UI work in `game-node-clients` (a hand-off is generated as a task)

## Capabilities

### New Capabilities

- `nintendo-sync`: Nintendo Account linking through a pasted delegated link, session-token lifecycle, and library and playtime import from play history.

### Modified Capabilities

- `connection-auth`: mode-enforced onboarding lists `nintendo` as a delegated-code provider, and the re-auth notification covers Nintendo.
- `connection-provider-registry`: provider discovery lists `nintendo` and its capabilities, and shared library matching covers Nintendo.
- `external-game-mapping`: a new GameNode-only category, `NintendoTitleId`.
- `unmapped-external-games`: Nintendo imports and playtime syncs register unmapped title IDs, with the Nintendo title name.

## Impact

- **Code:**
  - New `src/sync/nintendo/`: auth provider, sync auth service, sync service and module.
  - `src/connection/`: constants, registry and module registration.
  - `src/importer/`: Nintendo handler in `importer.service.ts`, plus `importer.constants.ts`, `importer.util.ts` and `importer.module.ts`.
  - `src/playtime/`: Nintendo handler in `playtime-watch.processor.ts`, `playtime-watch.module.ts` and `playtime.util.ts`. `UserPlaytimeSource.NSWITCH` already exists.
  - `src/game/game-repository/game-repository.constants.ts`: `NintendoTitleId = 1002`.
  - `src/mcp/mcp-tools.ts`: mapping category allowlist.
  - `src/notifications/`: provider enums and the provider display name.
- **Persistence:** none. `user_connection.type` and the playtime source are varchar, and mappings use the existing `game_external_game` origin model.
- **Configuration:** none. The Nintendo Store app's client ID is public and has no secret, so it is a constant.
- **External dependencies:** unofficial Nintendo endpoints: account login and token at `accounts.nintendo.com`, user info at `api.accounts.nintendo.com`, play history at `app-api.znej.nintendo.com`. No new npm dependency.
- **API:**
  - `GET /v1/connections` gains `nintendo`.
  - `auth/init` and `auth/callback` accept `nintendo`.
  - The OpenAPI file must be regenerated.
- **Clients:** the existing delegated-code paste box works unchanged. The web and mobile clients need Nintendo-specific copy ("right-click or long-press 'Select this account' and copy the link"), the Nintendo display name and icon, and Nintendo in the import notification provider names.
