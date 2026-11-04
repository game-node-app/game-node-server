# Proposal

## Why

GOG users cannot connect their accounts or import their games, playtime and achievements into GameNode. The existing connection registry, encrypted credentials, importer and player-sync pipelines provide the foundation to support GOG with provider-specific adapters.

## What Changes

- Add `gog` with `authMode: "delegated_code"`: users sign in on GOG and paste the resulting GOG callback URL into the existing init/callback flow. Store and refresh per-connection credentials encrypted, with the existing re-authentication status and notification.
- Import owned GOG games manually and automatically, including unplayed games. Exclude other stores linked to Galaxy. Reuse category `Gog` (5), shared matching, processed/ignored handling and the unmapped curation queue.
- Import GOG-reported cumulative playtime on PC, preserving existing values on incomplete responses. Only import activity tracked by GOG; do not invent offline playtime or session dates.
- Support GOG achievement definitions and obtained achievements through the existing read endpoints, per-game queues, completion calculation and activity publication. Enable initial coverage, changed-game selection and periodic reconciliation, including games with no playtime.
- Extend source conversions, module registrations, notifications, MCP mapping-category filters and API documentation to cover GOG.
- Out of scope: client UI implementation, importing Steam/Epic/etc. through Galaxy, uploading sessions or unlocking achievements on GOG, game downloads, cloud saves, new mapping categories, bulk mapping fills and new dependencies.

## Capabilities

### New Capabilities

- `gog-sync`: GOG credential lifecycle, complete owned-library retrieval and cumulative playtime retrieval through per-account provider adapters.

### Modified Capabilities

- `connection-auth`: GOG delegated-code onboarding and re-authentication notifications.
- `connection-provider-registry`: GOG discovery, capabilities and shared matching.
- `unmapped-external-games`: register unmapped GOG product IDs and owners.
- `mcp-mapping-tools`: accept the existing `Gog` category in mapping tools.
- `game-achievement-import`: GOG definitions and unlocks, consistent per-user snapshots, queue dispatch and completion.

## Impact

- New `src/sync/gog/` adapter module, auth provider, token helper, refresh service, sync service, types and focused tests/fixtures.
- Existing `src/connection/`, `src/importer/`, `src/playtime/`, `src/game/game-achievement/`, `src/game/external-game/external-game.utils.ts`, `src/notifications/` and `src/mcp/mcp-tools.ts`; nearby constructor mocks and worker-module fixtures must follow the new injection graph.
- Reuse `UserPlaytimeSource.GOG` and `EGameExternalGameCategory.Gog`; connection/importer sources and achievement job dispatch gain GOG. No database migration is expected: current connection/source columns already accept string values.
- Additive API changes: GOG discovery and source enums, existing init/callback and sync/read contracts. Regenerate `server_swagger.json` and provide a client handoff for GOG login instructions, source labels and achievements.
- GOG endpoints are unofficial for this integration. Community client source demonstrates token, library, playtime and achievement requests; live verification of payloads, pagination, units and unsupported responses remains an explicit implementation acceptance task. No real-account validation was performed during planning.
