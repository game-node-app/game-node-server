# Proposal

## Why

Several hot read paths on the home, profile, and release-calendar screens trigger large uncached queries, N+1 request bursts, or oversized payloads: `POST /v1/game/repository/collection` returns ~1.5 MB in 2.0–2.2 s uncached (with a buggy mature-theme join), cold and deep pages of `POST /v1/statistics/rankings` take 1.0–2.9 s, cards fire per-item requests for profiles (`GET /v1/profile/:id`), statistics (`POST /v1/statistics`), comment counts (`POST /v1/comment`), and owned library entries (`GET /v1/collections-entries/game/:id`, up to 90 calls on the release strip), `GET /v1/journal/overview/:id` loads full library relations to return ~118 KB, `GET /v1/blog/post` spends 0.4–1.4 s re-sanitizing and checking media on short-TTL CMS fetches, and `GameRepositoryService.findAllByIds` caches by whole ID-set so varied batches rarely hit cache.

Addressing these together eliminates the dominant API latency bottlenecks and N+1 waterfalls across home, profile, and release views while keeping existing clients compatible.

## What Changes

- **Release collection queries (`POST /v1/game/repository/collection`):**
  - Accept optional `from` and `to` ISO date bounds to constrain `firstReleaseDate` (so callers like the 30-day release strip and monthly calendar no longer request 1,000 upcoming games).
  - **BREAKING (lean default payload):** Omit unused heavy fields (`storyline`, `url`, `checksum`, internal/timestamp columns, and unused `GamePlatform`/`GameCover` columns) from collection responses by default while retaining the fields verified in `game-node-clients` (`id`, `name`, `slug`, `category`, `status`, `firstReleaseDate`, `summary`, plus slim `cover` and `platforms` when requested).
  - Fix mature-content filtering by replacing the TypeORM many-to-many `themes: { id: Not(MATURE_THEME_ID) }` join with a `NOT EXISTS` predicate so games without themes are included and mature games with additional themes are excluded.
  - Cache collection query results with `@Cacheable` and add a composite index on `game (firstReleaseDate, category)`.
- **Statistics rankings (`POST /v1/statistics/rankings`):**
  - Drive prepared game ranking queries from `ranking_score` (`score > 0`) via direct joins instead of scanning `game` with `STRAIGHT_JOIN` and a derived subquery.
  - Cache prepared game ranking totals independently of `offset`/`limit` under `asOf`, and warm default page 0 of common game rankings at the end of `refreshCommonScores()`.
  - Replace derived-table score joins on review rankings with a direct `LEFT JOIN ranking_score`.
- **Batch profile reads & review profile hydration:**
  - Add public `POST /v1/profile/all` accepting a bounded list of `userIds` (1–100) and returning `ProfileResponseDto[]` loaded in batched queries (profiles + media, supporter status, library access, videos, supporter preferences), omitting missing IDs.
  - Embed summary author `profile` (with `avatar`) on review read responses (`GET /v1/reviews/profile/:userId`, `GET /v1/reviews/game/:id`, `POST /v1/reviews/all`, `GET /v1/reviews`, `GET /v1/reviews/:id`), matching the pattern already established by `hydrate-activity-feed` for activities.
- **Statistics comment counts & batch summary endpoint:**
  - Add `commentsCount` (total comments including replies for `review`, `activity`, and `post`; `0` for non-commentable sources) to `StatisticsSummaryDto` (`POST /v1/statistics`).
  - Add read-only, lock-free `POST /v1/statistics/batch` accepting `{ sourceType, sourceIds }` (1–100 IDs) and returning per-source `viewsCount`, `likesCount`, `commentsCount`, and viewer `isLiked`/`isViewed` flags alongside projection freshness metadata, omitting missing or inaccessible sources without creating orphan targets.
  - Avoid unnecessary `FOR UPDATE` locks and writes on read-only `POST /v1/statistics` summary lookups.
- **Batch own library entry lookup (`POST /v1/collections-entries/own`):**
  - Add authenticated `POST /v1/collections-entries/own` accepting `{ gameIds: number[] }` (1–200 IDs) and returning the caller's existing `CollectionEntry[]` (empty array if none match, never 404).
  - Add a composite index on `collection_entry (libraryUserId, gameId)`.
- **Smaller payloads and smarter caching:**
  - `GET /v1/journal/overview/:userId`: accept optional `?year=YYYY` filter (all years when omitted for backwards compatibility), replace the full-relation library query with a minimal column projection, and cache responses in Redis partitioned by `LibraryAudienceKey` and `year`.
  - `GET /v1/blog/post` (and public detail/tags): extend published CMS cache TTL and cache sanitized/verified public presentation outputs in Redis while keeping staff previews strictly uncached (`Cache-Control: private, no-store`).
  - `GameRepositoryService.findAllByIds`: replace whole-ID-set `@Cacheable` with per-game caching keyed by `(gameId, canonicalRelations)` via batched `mget`/`mset`, querying MySQL only for cache misses and reassembling in the requested order (shared with `findOneByIdOrFail`).

Out of scope: frontend changes in `game-node-clients` (tracked as a follow-up once the regenerated OpenAPI client ships), cursor pagination for rankings or reviews, and changing the `blog-content-delivery` public article field schema.

## Capabilities

### New Capabilities
- `game-repository-reads`: reading games by IDs with per-game caching and querying release collections (`upcoming`, `recently_released`) with optional date bounds, lean projections, caching, and accurate mature-theme exclusion.
- `profile-reads`: batched public profile lookups (`POST /v1/profile/all`) and embedded author summary profiles on review reads.
- `library-entry-lookups`: batched authenticated lookups of a user's own collection entries by game IDs (`POST /v1/collections-entries/own`).
- `journal-overview`: reading a user's journal overview with optional year filtering, minimal database projection, and audience-partitioned caching.

### Modified Capabilities
- `engagement-statistics`: add `commentsCount` (all comments including replies) to source summaries, add lock-free batch summary/status reads (`POST /v1/statistics/batch`), and remove write-locking from read-only summary reads.
- `popularity-rankings`: drive prepared ranking queries from `ranking_score`, share cached filtered totals across pages under `asOf`, and warm initial pages of common prepared game rankings on refresh.
- `blog-content-delivery`: allow bounded public caching of sanitized and media-verified published blog reads while preserving uncached staff preview isolation and 503 upstream failure semantics.

## Impact

- **Code:**
  - `src/game/game-repository/*` (controller, service, collection DTO, per-game cache helper)
  - `src/statistics/*` (controller, service, ranking service, DTOs, target repository)
  - `src/profile/*` (controller, service, batch DTO, video & supporter-preferences batch helpers), `src/auth/auth.service.ts`, `src/billing/billing.service.ts`, `src/libraries/library-access.service.ts`
  - `src/reviews/*` (service relations, response DTO/Swagger types)
  - `src/collections/collections-entries/*` (controller, service, batch DTO, entity index)
  - `src/journal/*` (controller, service, query DTO, module imports for `LibraryAccessService` / `CollectionEntry`)
  - `src/blog/blog-post/*` (CMS service, delivery/presentation caching)
- **Database:** One migration adding composite indexes `IDX_game_release_category` on `game (firstReleaseDate, category)` and `IDX_collection_entry_library_game` on `collection_entry (libraryUserId, gameId)`.
- **API:** Additive new endpoints (`POST /v1/profile/all`, `POST /v1/statistics/batch`, `POST /v1/collections-entries/own`), additive fields/query params (`from`/`to` on collection, `commentsCount` on statistics summary, `profile` on reviews, `?year=` on journal overview), and trimmed unused columns on `POST /v1/game/repository/collection`. Regenerated OpenAPI spec (`server_swagger.json`) will unlock follow-up adoption in `game-node-clients`.
- **Caching:** Redis cache entries for release collections, per-game repository rows, prepared ranking totals/pages, audience-partitioned journal overviews, and presented public blog articles; all fail open to DB/CMS on cache errors.
