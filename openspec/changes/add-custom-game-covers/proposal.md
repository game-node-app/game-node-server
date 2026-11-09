# Proposal

## Why

GameNode always shows the single IGDB primary cover, while IGDB also carries localized, edition, alternative and historical covers that players care about. Backloggd already lets every user pick among those, so we want parity in the first version, without storing images and without adding a request or per-user cache entries to the shared game catalog path.

## What Changes

- Import the extra cover sources from IGDB into one catalog of cover options: localized covers, edition covers linked by `version_parent`, and alternative and historical covers from both `covers` and `artworks`.
- Let any signed-in user choose one cover option per game, or return to the default cover. No upload, and no supporter restriction.
- Add a profile setting for how custom covers are displayed: `any` (default), `prefer_yours` or `none`.
- Apply the effective cover on `POST /v1/game/repository` and `POST /v1/game/repository/:id` when a caller opts in, replacing `game.cover` in the response without changing the shared game cache or the response shape.
- Add a `hasCustomCover` filter to the library and collection entry listings.
- Route localized, alternative and historical covers in the IGDB sweep to the option catalog. This also stops the sweep from refetching a parent game for each of those covers on every run.
- Generate a web/mobile client hand-off as the final task. Client implementation is not part of this change.

Not included: custom covers in search results (Manticore `cover_url`), image uploads, storefront and ownership badges on covers, supporter gating, covers with an `image_type` other than primary, alternative or historical, and removal of cover options that disappear from IGDB.

## Capabilities

### New Capabilities

- `custom-game-covers`: Cover option catalog per game, per-user cover choice, display mode setting, effective cover resolution on game reads, and the custom cover library filter.

### Modified Capabilities

- `igdb-catalog-sync`: Sweep comparison and routing now cover non-primary `covers` and alternative or historical `artworks`, and game imports store edition links and localization regions.

## Impact

- **API**: new `GET /v1/game/cover/:gameId/options`, and `GET`, `PUT` and `DELETE /v1/game/cover/:gameId/mine`; additive optional fields on game repository reads and entry listings; additive display mode on the profile read and update.
- **Code**: `src/game/game-repository` (entities, service, controller, create service), new game cover module, `src/sync/igdb/catalog` (fields, endpoints, refresh), `src/collections/collections-entries` (filter), `src/profile` (setting), new migration.
- **Data**: about 34 thousand option rows from a 2026-11-09 IGDB count, one user choice row per customized game, one new `profile` column and two new `game` columns. No image storage.
- **IGDB budget**: one refetch of about 8,100 edition games, plus about 30 page requests for localized cover details, inside the existing sweep budget. Later sweeps do fewer refetches than today.
- **Performance**: no extra HTTP request. Requests that opt in cost one session lookup, one profile lookup and one choice lookup. Requests that do not opt in cost the same as today.
- **Clients**: no change is required for existing builds, since callers that do not opt in get today's response. Web and mobile adopt the feature through the hand-off.
