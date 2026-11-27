# Design

## Context

See [proposal.md](./proposal.md) for motivation and scope. All changes live in `game-node-server` (NestJS + TypeORM/MySQL + Redis via `@nestjs/cache-manager` / `cache-manager` v6 + `@keyv/redis`). Recent commits already established relevant patterns we build on directly:
- `hydrate-activity-feed` (`2088d66d`): embedded `profile: { avatar: true }` and lock-free `findLikeSummaries` on activities.
- `resolveLibraryAudienceKey` (`src/profile/profile-metrics/library-audience-key.ts`): audience + hidden-game fingerprint cache keying for library-visibility-aware reads.
- `47567be6` and `824b0225`: `ranking_score` now stores positive scores only for games and caches prepared game ranking responses under `asOf`.
- `ced7ec5e`: `BlogCmsService.published()` caches raw Directus collections for 2 minutes.

Client call sites in `game-node-clients` were inspected to verify payload compatibility (notably `ReleaseCalendar.tsx:84` renders `game.summary` in the agenda panel, `ReleaseStrip.tsx` only displays 30 days and fires per-game `findOwnEntryByGameId`, `ItemCommentsButton.tsx` fetches `POST /v1/comment` solely for the comment count, and `BlogPostCard.tsx` never renders `post.content`).

## Goals / Non-Goals

**Goals:**
- Cut latency and payload size on `POST /v1/game/repository/collection`, `POST /v1/statistics/rankings`, `GET /v1/journal/overview/:id`, `GET /v1/blog/post`, and `GameRepositoryService.findAllByIds`.
- Provide single-round-trip batch endpoints (`POST /v1/profile/all`, `POST /v1/statistics/batch`, `POST /v1/collections-entries/own`) and additive hydration (`profile` on reviews, `commentsCount` on statistics summaries) to eliminate N+1 waterfalls.
- Keep cache layers fail-open on Redis errors and preserve all access-control and library-visibility invariants.

**Non-Goals:**
- Editing `game-node-clients` (follow-up after regenerating OpenAPI client).
- Replacing offset pagination with cursor pagination or altering `BlogArticleDto`'s public field contract.
- Adding new external dependencies or background job queues.

## Decisions

### 1. Release collection query (`POST /v1/game/repository/collection`)
- **QueryBuilder + `NOT EXISTS` mature filter:** Replace `this.gameRepository.findAndCount` with a `SelectQueryBuilder` using:
  `NOT EXISTS (SELECT 1 FROM game_themes_game_theme mature WHERE mature.gameId = game.id AND mature.gameThemeId = :matureThemeId)`.
  *Rationale:* Matches `StatisticsRankingService.sourceQuery` (`src/statistics/statistics-ranking.service.ts:310`), fixes both bugs of TypeORM's `themes: { id: Not(42) }` join (including unthemed games and excluding multi-themed mature games), and avoids row multiplication.
- **Optional `from` / `to` bounds + validation:** Add optional `@IsISO8601()` `from?: string` and `to?: string` to `FindGamesByCollectionTypeRequestDto`. Reject invalid dates or `from > to` with `BadRequestException`. For `UPCOMING`, default `from` to `startOfToday` (UTC) and apply `<= to` only when `to` is provided. For `RECENTLY_RELEASED`, default `from` to 30 days ago and `to` to `endOfToday` (UTC), allowing caller overrides.
- **Lean column projection:** Select `game.id`, `game.name`, `game.slug`, `game.category`, `game.status`, `game.firstReleaseDate`, `game.summary`. When `dto.relations?.cover` is truthy, left-join and select only `cover.id`, `cover.imageId`, `cover.url`, `cover.width`, `cover.height`, `cover.gameId`. When `dto.relations?.platforms` is truthy, left-join and select only `platforms.id`, `platforms.name`, `platforms.abbreviation`. Other requested relations (if any) still join normally.
  *Alternative considered:* Dropping `summary` too. Rejected after verifying `ReleaseCalendar.tsx:84` renders `game.summary` in the agenda panel; combining `from`/`to` (30-day window ~100 games instead of 1,000) with dropping `storyline`, `url`, `checksum`, timestamps, internal columns, and platform/cover metadata already cuts the payload by >90% without breaking the calendar agenda.
- **Caching & index:** Cache normalized `(collectionType, dayBucketOrFrom, to, offset, limit, canonicalRelations)` in Redis for 15 minutes (including the current UTC `YYYY-MM-DD` when `from`/`to` are omitted so midnight rollovers don't drift beyond TTL). Add `IDX_game_release_category` on `game (firstReleaseDate, category)` so range predicates with `ORDER BY firstReleaseDate ASC` use an index range scan without a full table scan or filesort.

### 2. Statistics rankings (`POST /v1/statistics/rankings`)
- **Drive prepared game queries from `ranking_score`:** Replace:
  `FROM game g USE INDEX (...) STRAIGHT_JOIN statistics_target t ... JOIN (SELECT targetId, score FROM ranking_score WHERE rankingKey = ?) prepared ...`
  with:
  `FROM ranking_score prepared STRAIGHT_JOIN game g ON g.statisticsTargetId = prepared.targetId STRAIGHT_JOIN statistics_target t ON t.id = prepared.targetId`
  and predicates `prepared.rankingKey = ? AND prepared.score > 0` plus existing `game` / `t.isActive = 1` / mature `NOT EXISTS` / criteria filters.
  *Rationale:* Since `824b0225`, `ranking_score` stores only positive-score games (~10% of the ~377k catalog). Driving from `ranking_score` using `IDX_ranking_score_order (rankingKey, score, targetId)` and looking up `game` via unique `UQ_game_statistics_target` avoids scanning ~340k unscored rows and eliminates the derived-table subquery.
- **Direct join for prepared review rankings:** Replace `LEFT JOIN (SELECT targetId, score FROM ranking_score WHERE rankingKey = ?) prepared` with `LEFT JOIN ranking_score prepared ON prepared.rankingKey = ? AND prepared.targetId = t.id`.
- **Cross-page `total` cache for prepared game rankings:** Add a cache key `statistics:rank:v3:${definitionVersion}:total:${filterHash}:${asOfInstant.iso}` (6h TTL) independent of `offset` and `limit`. Deep pages (`offset: 60, 80, ...`) skip `COUNT(*)` completely and only execute the single paged `SELECT ... LIMIT ? OFFSET ?` + `metric_total` lookup.
- **Post-refresh page-0 warm-up:** At the end of `refreshCommonScores()`, warm the default page (`offset: 0, limit: 20`, no extra criteria) for common prepared game rankings (`popular:week`, `popular:month`, `popular:all`, `recent:week`) with best-effort error handling so refresh never fails if warming hits a transient cache error.
  *Alternative considered:* Caching top-N (e.g. 200 items) in one Redis blob and slicing in app memory. Rejected because `criteria` filters can be arbitrary, whereas driving from `ranking_score` + caching `total` under `asOf` + warming page 0 speeds up both filtered and unfiltered deep pages with minimal new code.

### 3. Batch profiles (`POST /v1/profile/all`) & embedded review profiles
- **Batched `ProfileController` / `ProfileService`:**
  - `POST /v1/profile/all` (`@Public()`, `@HttpCode(200)`) accepts `FindProfilesByIdsDto { @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) userIds: string[] }`.
  - Deduplicates `userIds` while preserving request order on output (omitting missing profiles).
  - Loads all related data in O(1) queries regardless of batch size:
    1. `profileRepository.find({ where: { userId: In(uniqueIds) }, relations: { avatar: true, banner: true } })`
    2. `AuthService.getSubscriptionsForUsers(uniqueIds)` (`where: [{ field: "referenceId", operator: "in", value: uniqueIds }]`) → `BillingService.findSupporterUserIdsIn(uniqueIds)` (returning `Set<string>`, fail-closed to empty set on error just like `ProfileVideoService.isSupporter`).
    3. `LibraryAccessService.resolveMany(viewerId, profiles)` — reuses already-loaded `profile.libraryVisibility` and executes a single `user_follow` `IN (:...ownerIds)` query for signed-in viewers (0 follow queries for anonymous viewers).
    4. For the subset of supporter IDs only: one `ProfileVideo` query (`profileUserId: In(supporterIds)`) and one `ProfileSupporterPreferences` query (`profileUserId: In(supporterIds)`).
  - Returns `ProfileResponseDto[]` without `videoUploads` (same public contract as `GET /v1/profile/:id`).
- **Reviews author profile embedding:** Set `private relations: FindOptionsRelations<Review> = { profile: { avatar: true } }` in `ReviewsService` so every review read (`findAllByUserId`, `findAllByGameId`, `findAllByIdIn`, `findOneById`, `findOneByUserIdAndGameId`) embeds `profile` with `avatar`. Note: `createOrUpdate` updates `mergedEntry` — pass explicit column fields (or avoid passing loaded `profile` relation into `reviewsRepository.update`) so TypeORM's `.update()` does not choke on relation properties!
  *Alternative considered:* Creating a separate `ReviewResponseDto` mapper. Keeping `Review` with `profile: { avatar: true }` loaded matches `ActivitiesRepositoryService` and keeps existing Swagger/entity shapes additive.

### 4. Statistics `commentsCount`, lock-free summaries, and `POST /v1/statistics/batch`
- **Comment count helper:** Add a small SQL helper in `StatisticsService` (or `statistics-target.repository.ts`) mapping `review` → `review_comment.reviewId`, `activity` → `activity_comment.activityId`, `post` → `post_comment.postId` and executing:
  `SELECT <fk> AS sourceId, COUNT(*) AS commentsCount FROM <table> WHERE <fk> IN (?) GROUP BY <fk>`.
  Counting all rows (`COUNT(*)`, no `childOfId IS NULL` filter) counts both top-level comments and replies per user decision. Each comment table already has an index on its root FK (`reviewId`, `activityId`, `postId`). For non-commentable types (`game`, `*_comment`), skip the query and return `0`.
- **Read-only summary resolution (no `FOR UPDATE`, no writes):**
  - Currently `findSummary` opens a transaction and calls `resolveSource(manager, dto, true)` which acquires `FOR UPDATE` locks and inserts into `statistics_target`.
  - Add a read-only source-resolution path (`resolveSourcesReadOnly`) that checks existence (and library access for activities via `LibraryAccessService`, matching `lockNotificationRoot`), reads `statisticsTargetId` without `FOR UPDATE` and without creating targets. If `statisticsTargetId` is `null` on an existing legacy row, treat `viewsCount` and `likesCount` as `0`.
  - Single `POST /v1/statistics`: uses read-only resolution (still throws 404 if missing/inaccessible), reads `metric_total` + `commentsCount` + `freshness` without locks or write transactions.
  - Batch `POST /v1/statistics/batch` (`@Public()`, `@HttpCode(200)`, `strictValidation`): accepts `StatisticsBatchSummaryRequestDto` (`sourceType`, `sourceIds` 1..100 validated against `sourceType` with the same game-int / content-UUID rules). Deduplicates `sourceIds`, resolves existing & accessible sources in 1–2 queries, fetches `metric_total` (`views` + `likes_current`), comment counts (`GROUP BY`), viewer `engagement_state` (`likedAt`, `lastViewedAt` when authenticated), and one `freshness()` call, returning `{ items, asOf, projectionLagSeconds, hasFailedEvents, historyComplete, completeSince }`.

### 5. Batch own library entries (`POST /v1/collections-entries/own`)
- Add `FindOwnCollectionEntriesByGameIdsDto` (`@ArrayMinSize(1) @ArrayMaxSize(200) @IsInt({ each: true }) @Min(1, { each: true }) gameIds: number[]`).
- Add `@Post("own")` `@HttpCode(HttpStatus.OK)` on `CollectionsEntriesController` (controller already has `@UseGuards(AuthGuard)` and `@UseInterceptors(ClassSerializerInterceptor)`).
- Query `collectionEntriesRepository.find({ where: { libraryUserId: userId, gameId: In(uniqueGameIds) }, relations: this.relations })`.
- Add composite index `IDX_collection_entry_library_game` on `collection_entry (libraryUserId, gameId)` via migration (non-unique to avoid migration failure if legacy duplicate rows exist).

### 6. Journal overview, Blog caching, and Per-game `findAllByIds` cache
- **`GET /v1/journal/overview/:userId`:**
  - Add `GetJournalOverviewQueryDto` with optional `@IsInt() @Min(1970) @Max(2100) year?: number`.
  - Replace the `findAllByUserIdWithPermissions(..., limit: 9999999)` call in `JournalService.getOverview` with:
    1. `libraryAccessService.resolve(viewerId, targetUserId)` (return `{ years: [] }` immediately if `!access.canViewLibrary`).
    2. `resolveLibraryAudienceKey(libraryAccessService, targetUserId, access)` and cache lookup under `journal:overview:v1:${targetUserId}:${audienceKey.audience}:${audienceKey.visibleEntryLevels.join(',')}:${audienceKey.hiddenFingerprint}:${year ?? 'all'}` (TTL 5 minutes, fail-open on cache error).
    3. Direct TypeORM query on `CollectionEntry` selecting ONLY `id`, `gameId`, `startedAt`, `finishedAt`, `droppedAt`, `plannedAt` where `libraryUserId = :targetUserId AND visibility IN (:...visibleLevels)` (and when `year` is provided, `AND (startedAt BETWEEN :yStart AND :yEnd OR finishedAt BETWEEN ... OR droppedAt BETWEEN ... OR plannedAt BETWEEN ...)`), with NO joins to `game`, `collectionsMap`, or `ownedPlatforms`.
    4. Filter status dates to `date.getFullYear() === year` when `year` is specified (matching existing local/UTC date grouping semantics of `JournalService`, keeping `JournalHeatmapService` untouched because it calls `getOverview(userId, targetUserId)` without `year`).
  - Note: `JournalService` must still preserve existing sorting order (entries sorted by latest status date DESC) and empty-library behavior.
- **`GET /v1/blog/post` (and public detail/tags):**
  - Increase `BlogCmsService.published()` TTL from 2 minutes to 10 minutes.
  - Add bounded Redis caching (10-minute TTL) for presented public articles in `BlogPresentationService` / `BlogDeliveryService` (e.g., cache the presented list of all published articles per `locale: 'en' | 'pt-BR'` once sanitized and `fs.access`-verified, or cache `list`/`one`/`tags` responses keyed by `(locale, tag, offset, limit)`). Caching per-locale presented articles (`blog:presented:v1:${locale}`, 10-minute TTL) means `list`, `one`, and `tags` ALL share one cached sanitized dataset per language (2 Redis keys total!), eliminating `sanitizeBlogHtml()` and `fs.access()` on every public request while `BlogPreviewController` continues calling `delivery.preview()` → `cms.articles(true)` → `presentation.present(..., preview = true)` completely uncached.
  - *Trade-off:* Newly published posts or updated Directus content take up to 10 minutes to appear publicly (vs 2 minutes today); cold CMS/media errors are never cached so 503 behavior is unchanged.
- **Per-game cache in `GameRepositoryService.findAllByIds`:**
  - Remove `@Cacheable` from `findAllByIds` and `findOneByIdOrFail`.
  - Add a deterministic canonical relation key helper (`canonicalizeRelations(relations)` → sorted JSON string of truthy relation paths, hashed with SHA-1 if long or used directly when simple, e.g. `cover=1,platforms=1` / `none`).
  - Key format: `game-repo:v1:${gameId}:${relKey}`, TTL 5 minutes.
  - In `findAllByIds`: deduplicate `dto.gameIds`, call `cacheManager.mget<Game>(keys)` (wrapped in try/catch to fail open to DB on Redis error), query MySQL only for missed IDs with `id: In(missedIds)`, write misses back via `cacheManager.mset(entries)` (each `{ key, value, ttl: minutes(5) }`, fire-and-forget `.catch(...)`), combine hits + DB rows, throw 404 if total found is 0, and return `reOrderByIds(dto.gameIds, combined)`.
  - `findOneByIdOrFail` reads/writes the exact same `game-repo:v1:${id}:${relKey}` key so single lookups warm batch lookups and vice versa.

## Risks / Trade-offs

- **[Lean `POST /v1/game/repository/collection` omits unused columns]** → Any unknown external caller relying on `storyline`, `url`, `checksum`, or extra `GamePlatform` fields would no longer receive them. Mitigation: all callers in `game-node-clients` were verified; `summary` is retained for `ReleaseCalendar.tsx`; `POST /v1/game/repository` (`findAllByIds`) remains full-row for detail views.
- **[Prepared game ranking `total` cached for up to 6h under `asOf`]** → Matches commit `47567be6`'s existing trade-off for prepared game pages (a game deleted/marked mature between refreshes stays in prepared counts until next refresh, whereas review rankings and explicit intervals keep live revalidation).
- **[10-minute blog presentation cache]** → Editorial publishes take up to 10 minutes to appear on public routes (up from 2 minutes). Mitigation: staff previews remain live and uncached; TTL is a single constant if editors later want webhook invalidation.
- **[`JournalService` 5-minute cache]** → When an owner adds/updates a game's status date without changing visibility, their journal overview may be up to 5 minutes stale. Mitigation: visibility changes immediately alter `LibraryAudienceKey` (never leaking private entries), and 5 minutes matches `ProfileMetricsService` and `GameRepositoryService` conventions; additionally we can keep invalidation simple or let TTL expire (no cross-module circular dependency with `CollectionsEntriesService`).
- **[`ReviewsService.update` with embedded `profile` relation]** → Calling `reviewsRepository.update(id, mergedEntry)` when `mergedEntry` has a loaded `profile` relation causes TypeORM errors or unwanted writes. Mitigation: update only the DTO fields (`content`, `rating`) on edit and cover with a unit/integration test.
- **[MySQL migration adding two indexes on large tables (`game`, `collection_entry`)]** → Online DDL (`ALGORITHM=INPLACE, LOCK=NONE` default in MySQL 8 for secondary indexes) keeps reads/writes unblocked, and CI verifies `migration:run` against an empty MySQL schema.

## Migration Plan

1. Add a single timestamped TypeORM migration (`AddPerformanceReadIndexes`) creating:
   - `IDX_game_release_category` on `game (firstReleaseDate, category)`
   - `IDX_collection_entry_library_game` on `collection_entry (libraryUserId, gameId)`
   With matching `down()` dropping both indexes, and matching `@Index(...)` decorators on `Game` and `CollectionEntry` entities.
2. Deploy server release (all new endpoints and fields are additive; `POST /v1/game/repository/collection` lean fields preserve every field read by current `game-node-clients`).
3. Regenerate `server_swagger.json` / OpenAPI client and adopt batch endpoints + `from`/`to` + `?year=` in `game-node-clients` in a follow-up PR.
4. Rollback: revert application deployment; the two new secondary indexes are harmless to keep or can be dropped with `migration:revert`.
