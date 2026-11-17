# Proposal

## Why

Activity list endpoints return bare `Activity` rows with only foreign keys, so the client (`ActivityItem` in game-node-clients) fires 7–9 follow-up requests per activity: profile, collection entry, collection, review, post, obtained-game-achievement activity, the author's whole achievement list, the game with cover, and two statistics calls (summary + status) for the like button. A 20-item feed page costs roughly 150 requests, and each statistics call opens a transaction with `FOR UPDATE` locks and may write a statistics target. The feed renders slowly and in pieces, and the backend does far more work than one page needs.

## What Changes

- Activity list and detail responses embed what an activity card needs, loaded in batches (one query per relation type for the whole page, never one per activity):
  - author profile with avatar
  - the source rows already modelled as relations on `Activity` (`collectionEntry`, `collection`, `review`, `post`, `obtainedGameAchievementActivity` with `externalGame`, and `obtainedAchievement` with its `definition`)
  - a resolved `game` (id, name, cover) for activities that target a game
  - a `statistics` summary (`likesCount`, `isLiked` for the viewer), read straight from `metric_total` / `engagement_state` through `activity.statisticsTargetId`, with no locks or writes
- Affected endpoints: `GET /activities`, `GET /v2/activities`, `GET /activities/feed`, `GET /activities/detail/:id`. All changes are additive fields, so existing clients keep working.
- New composite index `activity (profileUserId, createdAt)` for the profile activity lists and the following feed, which today filter by `profileUserId` and then filesort on `createdAt`.
- Follow-up in game-node-clients: `ActivityItem` reads the embedded data instead of its per-activity hooks; detailed achievement grids still load lazily when the popover opens.

Out of scope: keyset (cursor) pagination, removing `COUNT(*)` from paginated responses, and batching statistics for non-activity lists (reviews, posts).

## Capabilities

### New Capabilities
- `activity-feed`: listing and reading activities, including which related data each activity response embeds and how it is loaded.

### Modified Capabilities
<!-- None. engagement-statistics requirements are unchanged; activity responses only read its existing projections. -->

## Impact

- Code: `src/activities/activities-repository/*` (service, controllers, response DTOs), `src/activities/activities-feed/activities-feed.service.ts`, the `ActivitiesRepositoryModule` imports (`GameRepositoryModule`), and a new migration in `src/migrations`.
- API: additive response fields on four endpoints, plus a regenerated OpenAPI client in game-node-clients.
- DB: one new secondary index on `activity`. Every hydration lookup already hits a PK or unique index (`game_cover.gameId`, `metric_total (targetId, metricCode)`, `engagement_state (targetId, profileUserId)`).
- Payload: larger feed responses (roughly 20 embedded objects per page) in exchange for about 150 fewer requests.
- Caching: `/activities/feed` keeps its 5-minute per-session cache, so embedded `likesCount` / `isLiked` can be up to 5 minutes stale on that endpoint.
