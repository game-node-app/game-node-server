# Spec Delta

## ADDED Requirements

### Requirement: Source summaries include total comment counts
`POST /v1/statistics` SHALL include `commentsCount` in `StatisticsSummaryDto`. For commentable source types (`review`, `activity`, `post`), `commentsCount` SHALL equal the total number of persisted comments on that source, including both top-level comments and replies. For non-commentable source types (`game`, `review_comment`, `activity_comment`, `post_comment`), `commentsCount` SHALL be `0`.

#### Scenario: Review summary counts top-level comments and replies
- **WHEN** a review has 2 top-level comments and 3 replies
- **THEN** `POST /v1/statistics` returns `commentsCount: 5` alongside `viewsCount` and `likesCount`

#### Scenario: Non-commentable source reports zero comments
- **WHEN** a caller requests a summary for a `game` or `review_comment`
- **THEN** `POST /v1/statistics` returns `commentsCount: 0`

### Requirement: Statistics summaries and viewer status are batch-readable without write locks
`POST /v1/statistics/batch` SHALL accept `{ sourceType, sourceIds }` (1–100 native IDs) and run read-only queries without `FOR UPDATE` locks or target creation. It SHALL return per-source `viewsCount`, `likesCount`, `commentsCount`, and viewer `isLiked`/`isViewed` (`false` if anonymous) with freshness metadata, omitting missing or inaccessible sources. Single `POST /v1/statistics` reads SHALL likewise avoid write locks while keeping HTTP 404 for missing sources.

#### Scenario: Profile review list loads statistics and comment counts in one batch
- **WHEN** an authenticated caller posts `{ sourceType: "review", sourceIds: [r1, r2, r3] }` to `POST /v1/statistics/batch`
- **THEN** the response returns one item per accessible existing review with `viewsCount`, `likesCount`, `commentsCount`, `isLiked`, and `isViewed`, without acquiring `FOR UPDATE` locks

#### Scenario: Missing or inaccessible sources are omitted safely
- **WHEN** a caller posts a batch containing one accessible activity, one private activity belonging to another user, and one nonexistent UUID
- **THEN** only the accessible activity is returned and no statistics target rows are created

#### Scenario: Anonymous caller requests batch summaries
- **WHEN** an unauthenticated caller posts valid `sourceIds` to `POST /v1/statistics/batch`
- **THEN** every returned item has `isLiked: false` and `isViewed: false` alongside its public counts

#### Scenario: Invalid batch payload is rejected
- **WHEN** a caller submits an empty `sourceIds` array, more than 100 IDs, an ID incompatible with `sourceType`, or an unknown property
- **THEN** validation rejects the request with HTTP 400
