# Design

## Context

See [proposal.md](proposal.md) for motivation. `IgdbCatalogClient` fetches explicit expanded fields from `/v4/games`; `normalizeIgdbGame` converts nested snake_case keys before `IgdbCatalogImportService` starts the game transaction. `GameRepositoryCreateService` loads selected relationship branches and upserts one-to-many resources through `GamePropertyPathToEntityMap` and the shared leaf limiter.

Screenshots and artworks have source-ID primary keys and game foreign keys. Their importer upserts supplied records without removing previously imported records. Game queries already accept `FindOptionsRelations<Game>`, and the resource lookup uses the same entity map. Later catalog scans can skip unchanged relationships using epoch-week buckets, independently of the scan interval.

The official [Game Video contract](https://api-docs.igdb.com/#game-video) provides `id`, `game`, `name`, `video_id` and `checksum`; it does not provide a video URL, duration, resolution or upload date. The parent relationship is `videos`, plural, on [Game](https://api-docs.igdb.com/#game).

## Goals / Non-Goals

**Goals:** extend the existing media import and query paths with the smallest additive schema and preserve transaction, checksum and processing-bound guarantees.

**Non-Goals:** introduce another base class, resource service, queue, dependency, configuration option or default eager-loaded relation. Broader exclusions are in the proposal.

## Decisions

### 1. Dedicated video entity with the existing relation shape

Add `GameVideo` in `src/game/game-repository/entities/game-video.entity.ts` and a `Game.videos` one-to-many relation, with a many-to-one inverse `GameVideo.game`. Use a bigint source `id` primary column, nullable text `name`, `videoId`, `checksum` and `url`, and an indexed bigint game foreign key. Follow screenshot foreign-key naming, nullability and delete behavior; the importer always associates a video with its containing game.

Register the entity in `GameRepositoryModule` and `GamePropertyPathToEntityMap`. The runtime/migration entity globs and `IGDBPartialGame = DeepPartial<Game> & ...` already cover the new file and relationship. Test entity lists that explicitly enumerate related classes must include it; the IGDB harness's `importEntities()` derives its targets from the resource map.

Use a standalone entity because `GameImage` includes image-specific fields, while `GameResource` would add unrelated slug/date fields. A JSON column would bypass the existing relation and upsert paths.

### 2. Fetch expanded metadata and derive the URL at normalization

Add `videos.id`, `videos.game`, `videos.name`, `videos.video_id` and `videos.checksum` to `IGDB_CATALOG_FIELDS`. Keep them in the existing page request; do not query `/game_videos` separately or request unsupported `videos.url` fields.

Extend `normalizeIgdbGame` narrowly: validate raw videos before its existing key conversion, then enrich the converted video objects. Preserve `videoId` exactly and derive `url` as `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` for a non-empty string; otherwise store a null URL. Use explicit nulls for missing optional video columns so an updated record cannot keep a stale derived URL when its identifier disappears. The supplied `game` reference is validated, then the persistence handler assigns the actual parent relation as it does for screenshots.

Validate a supplied non-null collection as an array of objects with positive safe-integer IDs, string-or-null optional metadata, and a matching parent reference when supplied. Validate the raw values because generic normalization converts empty object properties to `undefined`, which would otherwise hide malformed collections or field values. Report malformed video data with the existing `CatalogDataError` and a bounded message identifying the containing game and failed field, before persistence. Do not use `InvalidGameEntryError`: the current runner intentionally skips that error and would checkpoint past the malformed video data.

This keeps source validation at the normalization boundary and avoids coercing malformed values or making requests to validate external video availability. A fixed URL template needs no YouTube API key or new helper abstraction.

### 3. Reuse the one-to-many persistence path

In `processRelationships`, add the videos presence flag, selected relation fields (`id` and `checksum`, as for other child media), existing-state loading, and `handleOneToMany(..., "videos", context)`. Use the current transaction manager, leaf limiter and settled-operation handling without changing the catalog runner or import-service contract.

The handler already upserts by source ID and honors child checksum/forced reconciliation. Existing games with unchanged base checksums receive videos when relationship processing is eligible; new and changed games follow the normal path. Failure rolls back the game and its required writes before page progress is recorded.

Keep the existing non-deleting semantics for absent, null, empty or reduced video collections. Replacing the collection or deleting absent rows would introduce a different media reconciliation policy and belongs in a separate request.

### 4. Use existing API routes and relation selection

`POST /v1/game/repository/:id` and `POST /v1/game/repository` accept `{ "relations": { "videos": true } }` through their current DTOs and services. The resource map also enables `GET /v1/game/repository/resource?resourceName=videos`. No new route, DTO option or eager loading is needed. Verify that serialized video records contain the stored metadata and URL; refresh `server_swagger.json` only if model generation changes its contract.

### 5. Extend existing fixtures and focused checks

Add a representative video to `expanded-game.ts`; its projection test then verifies every fetched video leaf. Extend normalization tests for URL encoding, absent metadata, null/empty collections and malformed entries. Extend importer tests and the isolated MySQL suite for association, changed-record updates, duplicate replay, unchanged-game reconciliation, retained absent records, and a video-write failure rolling back the game. Exercise existing query paths with `relations.videos` and resource lookup. Verify migration up/down on disposable MySQL, since the import suite's schema synchronization alone does not test migration SQL.

## Risks / Trade-offs

- **Existing catalogs fill gradually** → retain the current reconciliation policy and document its timing. Do not promise every unchanged game is updated on the next scan; skipped weeks and fourteen-day scans can delay bucket coverage. If a complete population pass is needed, operators can use the existing `IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH=false` for a full scan and restore it afterward, without resetting progress.
- **Removed or unavailable source videos remain locally** → preserve screenshot behavior; URLs are references and availability is not checked.
- **Schema missing at application start** → migrate before deploying code that registers `Game.videos`, including API replicas that can request the relation.
- **Baseline policy drift** → the existing catalog spec describes invalid-game failures and explicit resume, while the current runner/docs skip invalid base entries and auto-resume paused runs after cooldown. This delta leaves those policies untouched; video validation uses the non-skipped source-error path and existing retry/pause behavior.
- **Rollback loses imported video metadata** → reverting the new migration drops only the new table; a future import can recreate its contents.

## Migration Plan

1. Add one forward migration creating `game_video`, its source-ID primary key and indexed foreign key to `game`, matching entity metadata and MySQL charset/collation conventions. Leave the initial schema migration unchanged.
2. Verify up/down/up against disposable MySQL, then apply the migration before application rollout. No live IGDB credentials are needed for verification.
3. Deploy the importer and API changes together. Existing scheduling and durable progress continue; videos populate on eligible relationship processing. Document the existing override above for an operator who needs complete coverage in one full scan.
4. For rollback, deploy the previous application version before reverting the migration. Existing game rows, screenshots, artworks, statistics and catalog state remain intact.
