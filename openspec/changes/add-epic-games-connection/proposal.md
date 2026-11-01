# Proposal

## Why

Epic Games Store is the most relevant PC platform we don't support, but its library can't be matched the way Steam's is: IGDB stores Epic *offer* IDs, while a user's Epic library returns `namespace` and `catalogItemId`. We need mappings that IGDB doesn't provide. The only place to put them today is `ExternalGameService.submit`, which writes into the IGDB-owned `game_external_game` table with random IDs below 1,000,000. 110,543 real IGDB rows live in that range, so a moderator submission can overwrite an IGDB row. Building a GameNode-owned mapping store now unblocks Epic and every later provider IGDB doesn't map (RetroAchievements, Nintendo, and imports from a future desktop client).

## What Changes

- **GameNode-owned external game mappings.** `game_external_game` rows gain an `origin` (`igdb`, `bulk`, `curated`). GameNode rows get IDs from a reserved range that never collides with IGDB IDs. GameNode-only categories (starting with `EpicGamesNamespace`) live outside IGDB's enum range. The IGDB catalog sync ignores non-IGDB rows when it reconciles a game's external games, so curated rows survive re-syncs.
- **Fix moderator mapping submission.** `POST /v1/game/external` writes `curated` rows in the reserved ID range. It no longer replaces a game's other mapping of the same category, and it refuses to shadow an existing IGDB mapping.
- **Bulk mapping fill for Epic.** An admin-triggered job resolves each IGDB Epic store page slug to its Epic `namespace` through Epic's public store content API, and writes `bulk` namespace mappings. Ambiguous namespaces go to the unmapped queue for moderators.
- **Generic importer matching.** The per-provider `findUnprocessed*Entries` methods share a single matching path: drop processed and ignored entries, look up mappings by category, pick the preferred platform. Each provider only supplies its source IDs.
- **Delegated-code connection onboarding.** `delegated_code` providers use the existing `auth/init` and `auth/callback` endpoints. `init` returns a provider login URL the user opens in a new tab, and `callback` accepts the code the user pastes back, with the same single-use state. The unused `exchangeDelegatedCode` strategy method is removed.
- **Epic Games connection** (`type: "epicgames"`, `authMode: "delegated_code"`). It covers:
  - Epic account login through the Epic launcher OAuth client, with encrypted tokens and rotating refresh under a lock. A revoked or expired grant moves the connection to `reauth_required`.
  - Library import and auto-import through namespace mappings, on the PC platform.
  - Playtime import from Epic's per-account playtime endpoint.
- **Re-auth inbox notification.** Any connection that moves to `reauth_required` (Epic and Xbox) sends its owner a `connection.reauth-required` inbox notification, so users learn about it without opening the connections settings.
- **Notification DTO fix.** The import notification provider enums gain `epicgames`.
- Out of scope: Epic achievements, GOG and other providers, a scheduled re-run of the bulk fill, moderator overrides of IGDB-owned mappings, and client UI work in `game-node-clients`.

## Capabilities

### New Capabilities

- `external-game-mapping`: GameNode-owned mappings from external platform IDs to catalog games: origin tracking, reserved ID space, coexistence with IGDB catalog sync, moderator submission, bulk fill jobs, and the unmapped-game queue.
- `epic-games-sync`: Epic Games account linking through delegated code exchange, per-connection token lifecycle, library import and playtime import.

### Modified Capabilities

- `connection-auth`: mode-enforced onboarding and the state lifecycle now cover `delegated_code` providers on the init and callback endpoints. A connection that moves to `reauth_required` notifies its owner.
- `connection-provider-registry`: provider discovery lists `epicgames` with `authMode: "delegated_code"`, and library discovery resolves through one shared matching path.

## Impact

- **Persistence:** migration adding `origin` to `game_external_game`. `user_connection.type` is a varchar, so no enum migration is needed.
- **Code:**
  - `src/game/external-game/`: service, `submit`, and the new bulk fill job and admin trigger.
  - `src/game/game-repository/create/game-repository-create.service.ts`: the external games diff excludes non-IGDB rows.
  - `src/game/game-repository/game-repository.constants.ts`: new GameNode-only category.
  - `src/importer/importer.service.ts`: shared matching path and Epic handler.
  - `src/importer/importer.util.ts`, `src/importer/importer.constants.ts`, `src/playtime/playtime.util.ts`.
  - `src/playtime/watch/playtime-watch.processor.ts`: Epic playtime.
  - `src/connection/`: constants, registry, `connections.service.ts` mode checks, `connections.module.ts`.
  - New `src/sync/epic/`.
  - Xbox's token-refresh lock helpers move to a shared module, and its `reauth_required` changes go through the shared notification helper.
  - `src/notifications/`: the new event type, payload validation, projector case, a `connection` target DTO, and `epicgames` in the provider enums.
- **Configuration:** new `EPIC_OAUTH_CLIENT_ID` and `EPIC_OAUTH_CLIENT_SECRET`, set to the Epic launcher client.
- **External dependencies:** unofficial Epic endpoints (account OAuth, library service, store content API). No new npm dependency.
- **API:** `GET /v1/connections` gains `epicgames`. `auth/init` and `auth/callback` accept `epicgames`. A new admin endpoint triggers the Epic bulk fill. Regenerate the OpenAPI file.
- **Clients:** web and mobile need a paste-code UI for `delegated_code` providers. They also need a renderer and a tap target for `connection.reauth-required`, plus an Epic Games display name in import notifications. A hand-off for `game-node-clients` is generated as a task.
