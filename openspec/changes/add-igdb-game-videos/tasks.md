# Tasks

## 1. Video schema and entity registration

- [x] 1.1 Add `GameVideo` and `Game.videos`, register the entity in `GameRepositoryModule` and the resource map, and update explicit entity lists in affected test harnesses. Verify metadata initialization resolves all relations and `corepack yarn test:typecheck` passes; the map-derived IGDB harness must include the new entity.
- [x] 1.2 Add an additive `game_video` migration with source-ID primary key, nullable metadata columns and indexed game foreign key matching the entity and screenshot conventions. Verify up/down/up with a focused disposable-MySQL check, including that rollback preserves existing game/image/statistics rows.
- [x] 1.3 Document migration-before-rollout ordering and the rollback data loss limited to videos in `docs/igdb-catalog-sync.md`; verify the instructions match the tested migration sequence.

## 2. IGDB projection, validation and normalization

- [x] 2.1 Add the five explicit `videos` source fields to `IGDB_CATALOG_FIELDS` and representative video metadata to `expanded-game.ts`. Extend the field-projection/client tests to verify all video leaves are requested within the existing games request, with no wildcards, unsupported URL field or separate media request.
- [x] 2.2 Validate raw video collections/entries in `normalizeIgdbGame` before generic normalization, using `CatalogDataError` for invalid IDs, field types or parent references. Extend normalization tests for malformed arrays, null/non-object entries and empty object values; verify valid absent/null/empty collections and missing optional metadata are accepted.
- [x] 2.3 Derive and store the encoded HTTPS YouTube watch URL after key conversion, keeping the original `videoId` and explicit nulls for absent optional columns. Extend normalization tests for the exact URL, reserved-character encoding and missing/empty identifiers; document the distinction between source metadata and the derived URL, with no media downloads or availability requests.

## 3. Transactional import and existing queries

- [x] 3.1 Wire videos into `processRelationships` presence checks, selective existing-state loading and `handleOneToMany` using the shared context. Extend focused importer/MySQL tests to verify parent association, replay without duplicates, changed checksum/metadata/URL updates, URL removal when an updated identifier disappears, preserved statistics, and unchanged-base-checksum periodic/forced reconciliation.
- [x] 3.2 Extend import and recovery coverage to verify omitted/null/empty/reduced collections retain existing videos, a failing video write rolls back the game and leaves the page checkpoint unchanged, and retry completes safely. Verify malformed videos follow the failure path rather than the runner's invalid-base-game skip path, while existing relationship concurrency bounds remain enforced.
- [x] 3.3 Verify existing single-game and multiple-game queries with `relations.videos`, empty results for games without videos, default opt-in loading and the `videos` resource lookup, using focused tests on the existing repository paths. Document request/response examples in `docs/igdb-catalog-sync.md`; regenerate OpenAPI output only if the model change affects it.
- [x] 3.4 Document population of existing games under the current reconciliation policy, including that a complete population pass can use the existing checksum-skip override for one full scan before restoring it. Verify an unchanged game's missing videos are imported with the existing override and no catalog state reset; do not promise next-scan coverage for every game.

## 4. Integrated verification

- [x] 4.1 Run `corepack yarn test:typecheck`, `corepack yarn test:igdb:unit` and `corepack yarn test:igdb:integration` with the existing disposable service harness; run any focused repository tests outside those selections, then clean up the harness. Record results and confirm metadata-only video import coexists with screenshots/artworks, transaction recovery and processing bounds without live IGDB credentials or changes to scheduling/configuration.
