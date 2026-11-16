# Design

## Context

All four activity read paths go through `ActivitiesRepositoryService` (`findLatestBy`, `findOneByOrFail`), which already loads one relation (`obtainedAchievement`) with the default join strategy. `Activity` already declares every source as a TypeORM relation (`profile`, `collectionEntry`, `collection`, `review`, `userFollow`, `post`, `obtainedGameAchievementActivity`, `obtainedAchievement`) and the generated client types already include those properties. They are just never populated.

Engagement counters live in `metric_total` (`UQ (targetId, metricCode)`, metric `likes_current`) and per-user state lives in `engagement_state` (`UQ (targetId, profileUserId)`). Each activity already stores its `statisticsTargetId`. The public statistics endpoints resolve the source with `FOR UPDATE` and `ensureStatisticsTarget` on every read, which is the costly part of the like button's two calls.

`activity` indexes today: the PK, five unique `(profileUserId, <sourceId>)` composites, `(createdAt, id)`, and single-column FK indexes. Nothing serves `WHERE profileUserId [= | IN] … ORDER BY createdAt DESC`.

Every lookup the hydration needs already hits a PK or unique index: `profile.userId`, `profile_avatar.id`, `collection_entry.id`, `collection.id`, `review.id`, `post.id`, `user_follow.id`, `obtained_game_achievement_activity.id`, `game_external_game.id`, `obtained_achievement.id`, `achievement_definition.id`, `game.id`, `game_cover.gameId` (unique), `metric_total (targetId, metricCode)` and `engagement_state (targetId, profileUserId)`.

## Goals / Non-Goals

**Goals:**
- Load each embedded relation once per page, so the query count stays fixed as the page grows (see spec "Embedded data loads in bounded queries").
- Reuse the existing entity relations and services instead of adding a parallel read model.

**Non-Goals:**
- Embedding the per-achievement list of a game-achievement activity. It needs the external game's achievement catalog and is only shown inside a popover, so the client keeps fetching it on open.
- Changing like/unlike or the statistics endpoints themselves.
- Pagination changes (cursor pagination, dropping `COUNT`).

## Decisions

### D1. Load relations with TypeORM `relationLoadStrategy: "query"`
`findLatestBy` and `findOneByOrFail` pass these relations:
`profile.avatar`, `collectionEntry`, `collection`, `review`, `userFollow`, `post`, `obtainedGameAchievementActivity.externalGame`, `obtainedAchievement.definition`. They also set `relationLoadStrategy: "query"`, which the codebase already uses in `recap.service.ts` and `getRelationLoadStrategy`.

With the "query" strategy, the main query stays a plain `LIMIT/OFFSET` over `activity`, and TypeORM fetches each relation with one `IN (...)` query over the page's ids.
- *Alternative: joins.* About 10 LEFT JOINs combined with `skip/take` makes TypeORM run a `DISTINCT` id pre-query and return wide, duplicated rows. Rejected.
- *Alternative: hand-written per-type batch loaders.* They would do the same work as the "query" strategy with more code to maintain. Rejected.

`obtainedGameAchievementActivity.pendingDelivery` is internal (the single-item DTO mapping strips it). The hydration step deletes it from the embedded objects before returning.

### D2. Resolve `game` with one batched call after the relations load
Collect `gameId` from `collectionEntry.gameId`, `review.gameId`, `post.gameId` and `obtainedGameAchievementActivity.externalGame.gameId`, de-duplicate, and call the existing `GameRepositoryService.findAllByIds({ gameIds, relations: { cover: true } })` (cached for 5 minutes). Then attach `game` to each activity by id. Skip the call when the page has no game ids, because that method throws on an empty list. This requires `ActivitiesRepositoryModule` to import `GameRepositoryModule`.
- *Alternative: a nested relation such as `review.game.cover` per source.* That means four separate game/cover query pairs and no shared cache. Rejected.

### D3. Read like totals directly through `statisticsTargetId`
Add one exported function next to `createStatisticsTarget` / `ensureStatisticsTarget` in `src/statistics/statistics-target.repository.ts`. It takes `(manager, targetIds, userId?)` and runs two queries:
- `SELECT targetId, metricValue FROM metric_total WHERE metricCode = 'likes_current' AND targetId IN (?)`
- when `userId` is set: `SELECT targetId FROM engagement_state WHERE profileUserId = ? AND likedAt IS NOT NULL AND targetId IN (?)`

It returns a `Map<targetId, { likesCount, isLiked }>`. Activities with a null `statisticsTargetId` get `{ likesCount: 0, isLiked: false }`. There are no locks, no transaction and no `ensureStatisticsTarget` call, so reads never write (see the spec requirement on engagement summaries).
- *Alternative: inject `StatisticsService` and call `findSummary` / `getStatus` per activity.* That keeps the N+1 pattern and the locking. Rejected.
- *Alternative: a generic `POST /statistics/batch` endpoint.* It is useful for review and post lists too, but those lists are out of scope here, and it would still cost a second round-trip. Deferred.

### D4. Viewer identity reaches the service
`ActivitiesRepositoryController.findLatest`, `findOneById` and `ActivitiesRepositoryV2Controller.findLatest` add `@Session() session: SessionContainer | undefined` (the same pattern as the feed controller) and pass `session?.getUserId()` down. `findLatestBy` and `findOneByOrFail` take an optional `viewerUserId` as a new trailing parameter. Other callers of `findOneBy`, `findAllBy` and `create` are unchanged.

### D5. Response typing
Add `dto/activity-response.dto.ts`:
```ts
class ActivityStatisticsSummaryDto { likesCount: number; isLiked: boolean }
class ActivityResponseDto extends Activity { game: Game | null; statistics: ActivityStatisticsSummaryDto }
```
`ActivitiesPaginatedResponseDto.data`, `ActivitiesFeedPaginatedResponseDto.data` and the detail `@ApiOkResponse` switch to `ActivityResponseDto`. Keeping `Activity` as the base keeps the change additive for the generated client.

### D6. Index: `IDX_activity_profile_created (profileUserId, createdAt)`
Declare it on the entity (`@Index("IDX_activity_profile_created", ["profileUserId", "createdAt"])`) and add a migration in `src/migrations` (`<timestamp>-AddActivityProfileCreatedIndex.ts`, with `down` dropping it).
- Single-user lists (`GET /activities?userId=`, v2) then become an index range scan read backwards, with no filesort. The `type` filter is applied to the few rows read.
- Following feed (`profileUserId IN (…)`): MySQL still sorts, but only the followed users' rows, found through the index, instead of scanning the whole table.
- *Alternative: `(profileUserId, type, createdAt)`.* It helps only the v2 query when `type` is set, and it cannot give index ordering for the unfiltered query. Rejected; one index serves both.
- The global feed keeps using the existing `(createdAt, id)` index.

## Risks / Trade-offs

- [Feed responses get larger: full `review` (including content), `post` and `game` rows per item] → Responses are gzip-compressed and still far smaller than ~150 separate responses. If size becomes a problem, trim with a TypeORM `select` later, which needs no contract change for the fields the card uses.
- [`/activities/feed` is cached for 5 minutes per session, so embedded `isLiked` / `likesCount` can be stale after the viewer likes something] → The client uses the embedded statistics only as initial data for its existing statistics query. A like mutation still invalidates and refetches that single item.
- [`findAllByIds` throws 404 when none of the ids exist] → Game ids come from FK-backed columns, so they exist. Still, call it only with a non-empty list and treat 404 as "no games".
- [`ActivitiesRepositoryModule` gains an import of `GameRepositoryModule`] → `GameRepositoryModule` does not import activities, so no cycle. Verify at boot.
- [Index build on a large `activity` table] → InnoDB builds a secondary index online (`ALGORITHM=INPLACE, LOCK=NONE`); run the migration during normal deploys.

## Migration Plan

1. Deploy the server: the migration adds the index, and responses gain the new fields. Old clients ignore them.
2. Regenerate the OpenAPI wrapper in game-node-clients and ship the `ActivityItem` change.
3. Rollback: revert the server deploy and run the migration's `down` (drops the index). Clients that already read the embedded fields fall back to their per-activity hooks when the fields are absent (see tasks).
