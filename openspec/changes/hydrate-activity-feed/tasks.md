# Tasks

## 1. Index

- [x] 1.1 Add `@Index("IDX_activity_profile_created", ["profileUserId", "createdAt"])` to `src/activities/activities-repository/entities/activity.entity.ts`, and add the migration `src/migrations/<next-timestamp>-AddActivityProfileCreatedIndex.ts` (`up` creates the index, `down` drops it). Verify: run the migration against the local DB and confirm that `EXPLAIN SELECT * FROM activity WHERE profileUserId = ? ORDER BY createdAt DESC LIMIT 20` uses `IDX_activity_profile_created` with no `Using filesort`; then confirm `migration:revert` drops it.

## 2. Batched like summaries

- [x] 2.1 Add the exported function `findLikeSummaries(manager, targetIds, userId?)` to `src/statistics/statistics-target.repository.ts` (design D3). It runs two `IN` queries, takes no locks and makes no writes, and returns a `Map<targetId, { likesCount, isLiked }>`. Verify with a new case in an existing statistics integration spec (`pnpm test:statistics`): a liked target returns `isLiked: true` with the right count, an anonymous call returns `isLiked: false`, an empty list runs no query, and the `statistics_target` / `engagement_state` row counts are unchanged afterwards.

## 3. Activity hydration in the repository service

- [x] 3.1 Add `dto/activity-response.dto.ts` with `ActivityStatisticsSummaryDto` and `ActivityResponseDto extends Activity { game: Game | null; statistics }`, and point `ActivitiesPaginatedResponseDto.data`, `ActivitiesFeedPaginatedResponseDto.data` and the detail `@ApiOkResponse` at it. Verify: `pnpm test:typecheck` passes and the Swagger JSON at `/api-json` shows `game` and `statistics` on the activity schema.
- [x] 3.2 Import `GameRepositoryModule` in `ActivitiesRepositoryModule` and inject `GameRepositoryService` into `ActivitiesRepositoryService`. Update the manual constructions in `activities-repository.service.spec.ts` and `src/achievements/achievement-activity.integration.spec.ts` to pass the new argument. Verify: the app boots without a DI or circular-import error, and both specs pass.
- [x] 3.3 In `findLatestBy` and `findOneByOrFail`, load the relations from design D1 with `relationLoadStrategy: "query"`, add an optional trailing `viewerUserId`, and run a private `hydrate(activities, viewerUserId)` step. That step batch-loads `game` (D2, skipped when there are no ids, 404 treated as empty), attaches `statistics` (D3, `{0, false}` when `statisticsTargetId` is null) and strips `pendingDelivery`. Verify with new cases in `activities-repository.service.spec.ts`:
  - a page mixing collection, review, post, follow and achievement activities returns the expected `profile`, source relation, `game` (null for follow) and `statistics`
  - the number of queries (counted through the DataSource logger or a `query` spy) is the same for `take: 2` and `take: 10`
  - an anonymous call gives `isLiked: false`

## 4. Wire the viewer through the controllers

- [x] 4.1 Add `@Session() session: SessionContainer | undefined` to `ActivitiesRepositoryController.findLatest`, `findOneById` and `ActivitiesRepositoryV2Controller.findLatest`, and pass `session?.getUserId()` through `findLatestExcludingTypes`, `findLatest` and `findOneByOrFail`. Pass `userId` from `ActivitiesFeedService` into `findLatestBy` for both feed criteria. Verify: on a local server, `GET /v1/activities/feed?criteria=all` and `GET /v1/activities/detail/:id` as a logged-in user who liked an item return `statistics.isLiked: true`; the same calls without a session return `false`.

## 5. Integration check

- [x] 5.1 Against a local DB with seeded activities, check `GET /v1/activities?userId=…`, `GET /v2/activities?userId=…&type=REVIEW`, `GET /v1/activities/feed?criteria=following` and `GET /v1/activities/detail/:id`. Verify: existing fields and ordering match responses captured before the change (spec "Activity responses stay backward compatible"), every item carries the embedded fields, and `pnpm test` plus `pnpm test:typecheck` pass.

## 6. Client follow-up (game-node-clients repo)

- [x] 6.1 Regenerate `@repo/wrapper` from the updated OpenAPI spec. Verify: `Activity` / `ActivityResponseDto` types expose `game` and `statistics`, and the client typecheck passes.
- [x] 6.2 Change `packages/ui/src/components/activity/item/ActivityItem.tsx` to read `activity.profile`, `collection`, `review`, `game`, `obtainedGameAchievementActivity` and `obtainedAchievement.definition` directly. Keep the existing hooks only as fallbacks, enabled when the embedded field is missing, and drop `useAchievementsV2(profileUserId)`. Let `UserAvatar` accept an embedded profile so it skips `useUserProfile`. Verify: update `apps/mobile/src/components/activity/achievement-unlocked-activity.test.tsx` and `off-cover-call-sites.test.tsx`, and confirm in the browser network tab that a 20-item feed page triggers no per-activity profile, review, collection, post or game requests.
- [x] 6.3 Seed `ItemLikesButton` / `useItemStatistics` for `sourceType.ACTIVITY` with `activity.statistics` as `initialData` (only when the cache is empty), so the like button makes no request on render and like/unlike still invalidates and refetches. Verify: the network tab shows no `/statistics` or `/statistics/status` calls on feed load, and liking an item updates its count.
- [x] 6.4 Have `ObtainedAchievementActivityContent` fetch the detailed `GameObtainedAchievementActivityDto` only when the popover opens. Verify: no `obtained-game-achievement` request on feed load, and opening the popover shows the achievement grid.
