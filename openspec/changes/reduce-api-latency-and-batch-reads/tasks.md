# Tasks

## 1. Database Indexes & Migration

- [x] 1.1 Add `@Index("IDX_game_release_category", ["firstReleaseDate", "category"])` to `src/game/game-repository/entities/game.entity.ts`, `@Index("IDX_collection_entry_library_game", ["libraryUserId", "gameId"])` to `src/collections/collections-entries/entities/collection-entry.entity.ts`, and create a matching TypeORM migration in `src/migrations/` with `up()` and `down()` methods; verify with `pnpm run test:typecheck` and the migration glob/chain specs (`src/migrations/migration-glob.spec.ts`, `src/migrations/migration-chain.integration.spec.ts` when MySQL is available).

## 2. Release Collections & Per-Game Repository Caching

- [x] 2.1 Update `FindGamesByCollectionTypeRequestDto` in `src/game/game-repository/dto/game-repository-collection.dto.ts` to accept optional ISO-8601 `from` and `to` date strings, and rewrite `GameRepositoryService.findGamesByCollectionType` in `src/game/game-repository/game-repository.service.ts` to validate `from <= to` (HTTP 400 on invalid/inverted dates), filter mature games via `NOT EXISTS` on `game_themes_game_theme`, project lean `Game`/`GameCover`/`GamePlatform` fields (retaining `summary`), and cache normalized queries in Redis (15-minute TTL, fail-open); verify with unit tests in `src/game/game-repository/game-repository.service.spec.ts` covering date bounds, inverted dates, unthemed games, multi-themed mature games, lean fields, and cache hits/failures.
- [x] 2.2 Replace method-level `@Cacheable` on `GameRepositoryService.findAllByIds` and `findOneByIdOrFail` with per-game caching keyed by `(gameId, canonicalRelations)` using `cacheManager.mget`/`mset` (5-minute TTL, fail-open), querying MySQL only for missed IDs while preserving request order, 400/404 behavior, and post-cache cover personalization in `GameRepositoryController`; verify with unit tests in `src/game/game-repository/game-repository.service.spec.ts` and `src/game/game-repository/game-repository.controller.spec.ts` covering partial cache hits, relation key-order canonicalization, single-to-batch cache sharing, and cover personalization isolation.

## 3. Statistics Rankings Optimization

- [x] 3.1 Refactor `StatisticsRankingService` in `src/statistics/statistics-ranking.service.ts` to drive prepared game ranking queries from `ranking_score` (`rankingKey = ? AND score > 0`) joined directly to `game` and `statistics_target` (removing the `STRAIGHT_JOIN` from `game` and derived-table subquery), and replace the review ranking derived-table score join with a direct `LEFT JOIN ranking_score`; verify existing and new ranking tests pass (`pnpm run test -- src/statistics/statistics-ranking`).
- [x] 3.2 Add cross-page filtered `total` caching keyed by `(filterHash, asOf)` (6h TTL) for prepared game rankings and best-effort page-0 cache warming for common prepared game keys (`popular:week`, `popular:month`, `popular:all`, `recent:week`) at the end of `refreshCommonScores()`; verify with unit/integration tests in `src/statistics/statistics-ranking*.spec.ts` confirming deep pages (`offset: 60`) skip `COUNT(*)` under the same `asOf`, refresh supersedes old keys, and warming populates page 0 without failing refresh on cache errors.

## 4. Batch Profile Reads & Embedded Review Profiles

- [x] 4.1 Add batched lookup helpers: `AuthService.getSubscriptionsForUsers(userIds)` in `src/auth/auth.service.ts`, `BillingService.findSupporterUserIdsIn(userIds)` in `src/billing/billing.service.ts`, `LibraryAccessService.resolveMany(viewerId, profiles)` in `src/libraries/library-access.service.ts`, and batch video/supporter-preference readers in `ProfileVideoService` and `SupporterPreferencesService`; verify each helper with unit tests covering empty inputs, multiple users, supporter failure fallback, and follower/visibility rules.
- [x] 4.2 Add `FindProfilesByIdsDto` (`userIds`: 1–100 strings) and public `POST /v1/profile/all` (`@HttpCode(200)`) in `src/profile/profile.controller.ts` + `src/profile/profile.service.ts`, returning `ProfileResponseDto[]` in batched queries (omitting missing IDs, excluding `videoUploads`); verify with unit tests in `src/profile/profile.controller.spec.ts` covering public access, viewer-scoped `canViewLibrary`, missing/duplicate IDs, and 400 validation errors.
- [x] 4.3 Update `ReviewsService` in `src/reviews/reviews.service.ts` to load `profile: { avatar: true }` on review read queries and update `createOrUpdate` to pass only scalar fields to `reviewsRepository.update` (preventing relation write errors); verify with unit/integration tests covering embedded `profile` + `avatar` on review reads and review edits.

## 5. Statistics Comment Counts & Lock-Free Batch Summaries

- [x] 5.1 Add `commentsCount` to `StatisticsSummaryDto` and add `StatisticsBatchSummaryRequestDto` / `StatisticsBatchSummaryResponseDto` in `src/statistics/dto/statistics-api.dto.ts` with strict validation (`sourceType` + 1–100 valid `sourceIds` matching game-int or content-UUID rules); verify DTO validation with unit tests rejecting empty arrays, >100 IDs, mismatched ID formats, and unknown properties.
- [x] 5.2 Refactor `StatisticsService.findSummary` to read existing summaries without `FOR UPDATE` locks or target-creation writes (preserving 404 for missing/inaccessible sources), add total comment counting (top-level + replies for `review`, `activity`, `post`; `0` for `game` and `*_comment`), and implement `POST /v1/statistics/batch` in `src/statistics/statistics.controller.ts` and `src/statistics/statistics.service.ts` returning per-source `viewsCount`, `likesCount`, `commentsCount`, `isLiked`, `isViewed` plus freshness metadata while omitting missing/inaccessible sources; verify with unit/integration tests in `src/statistics/` covering comment counts with replies, anonymous vs authenticated flags, private activity omission, and lock-free reads.

## 6. Batch Own Library Entry Lookup

- [x] 6.1 Add `FindOwnCollectionEntriesByGameIdsDto` (`gameIds`: 1–200 positive integers), authenticated `POST /v1/collections-entries/own` (`@HttpCode(200)`) in `src/collections/collections-entries/collections-entries.controller.ts`, and `findOwnByGameIds(userId, gameIds)` in `src/collections/collections-entries/collections-entries.service.ts`; verify with unit tests in `src/collections/collections-entries/collections-entries.controller.spec.ts` and `collections-entries.service.spec.ts` covering owned subset, empty result (`[]`, not 404), deduplication, auth enforcement (401), and validation bounds (400).

## 7. Journal Overview & Blog Presentation Caching

- [x] 7.1 Add `GetJournalOverviewQueryDto` (optional `year` integer 1970–2100) to `GET /v1/journal/overview/:userId` in `src/journal/journal.controller.ts`, and rewrite `JournalService.getOverview` in `src/journal/journal.service.ts` (wiring `LibraryAccessService`, `CollectionEntry` repository, and `CACHE_MANAGER` in `src/journal/journal.module.ts`) to select only `id`, `gameId`, `startedAt`, `finishedAt`, `droppedAt`, `plannedAt` with visibility filtering, optional `year` filtering, and 5-minute Redis caching keyed by `resolveLibraryAudienceKey` + `year` (fail-open); verify with tests in `src/journal/journal.service.spec.ts` / `journal.service.integration.spec.ts` covering `?year=`, omitted `year`, invalid `year` (400), heatmap compatibility, and audience-partitioned cache isolation on visibility changes.
- [x] 7.2 Increase `BlogCmsService.published()` cache TTL to 10 minutes in `src/blog/blog-post/blog-cms.service.ts` and cache sanitized, media-verified public article presentations per locale (`en`, `pt-BR`) for 10 minutes in `BlogDeliveryService` / `BlogPresentationService` (fail-open on cache errors, never caching CMS/media 503 failures, and keeping `BlogPreviewController` completely uncached with `Cache-Control: private, no-store`); verify with unit tests in `src/blog/blog-post/` confirming cached list/detail/tag reads skip re-sanitization and `fs.access`, previews bypass cache, and cold CMS failures return 503.

## 8. Final Integration & Verification

- [x] 8.1 Run `pnpm run test:typecheck`, targeted Jest suites across `game-repository`, `statistics`, `profile`, `reviews`, `collections-entries`, `journal`, and `blog-post`, and confirm all checks pass cleanly.

## Workflow follow-up

- Regenerate `server_swagger.json` (on server boot or Swagger script) and update `game-node-clients` in a follow-up PR to adopt the new batch endpoints, `from`/`to` release bounds, and `?year=` journal filter.
- Archive the change (`openspec archive reduce-api-latency-and-batch-reads`) once implementation and review are complete.
