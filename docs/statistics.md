# Statistics system

## Replacement baseline

Baseline captured on 2026-10-26 from integrated commit `76bf0a4d8ec6676344e1589e0ac2ea2ed56676fd`, before any statistics-storage changes in this implementation.

| Command | Result |
| --- | --- |
| `yarn test:igdb:services:up` | Passed; disposable `igdb-sync-test` MySQL and Redis became healthy. |
| `yarn test:notifications` | Failed: 20/21 suites passed, 159/161 tests passed. Reaction, inbox, transport, delivery, and lifecycle suites passed. `notifications-cutover.integration.spec.ts` had two failures: an expected-absent `legacy-notification-<id>` event was already present, and a repeated conversion found two events for that legacy ID. The failure is recorded as baseline evidence and is not attributed to this change. |
| `yarn build` | Passed (`nest build`). |

The predecessor's recorded 21-suite/161-test result is not used as this fresh run. The cutover baseline failure is historical; the replacement-schema notification check below now passes.

## Storage and write ownership

Each source row has one nullable `statisticsTargetId` with a unique source-side foreign key to `statistics_target`. The native source identity remains unchanged: games keep their numeric IDs and content keeps UUIDs. New source creation initializes and links its target in the owning transaction, with `likes_current` set to zero. Existing domain rows can acquire a target when a statistics operation first resolves them.

| Store | Authority and meaning |
| --- | --- |
| `engagement_state` | Current actor/target like, durable `firstLikedAt`, and authenticated `lastViewedAt`. Anonymous views do not create actor state. |
| `statistics_event` | Append-only version-1 `view.recorded`, `like.added`, and `like.removed` facts. Projection changes operational bookkeeping; account deletion may anonymize `actorUserId`. |
| `metric_total` | Projected historical views/additions/removals/first-like credits. `likes_current` is written synchronously with reaction state and never by the projector. |
| `metric_hour` | UTC hour totals for projected facts; edges of requested ranges are read from completed facts for exact inclusion. |
| `ranking_score` | Disposable, per-key prepared scores for `engagement-v1`. A key is replaced in one transaction. |
The transition lock order is source/root/comment, target, actor state, active-like gauge, analytics event, then notification outbox. The reaction transaction commits all of these together. It uses the reaction transition UUID as both `like:<UUID>` event identity and notification intent ID; the event's safe numeric database ID remains payload `likeId`. Like additions, removals, current likes, first-known-like credit, and notification counts are separate measures. A relike creates a new notification transition but no second credit.

## API and time rules

| Operation | Contract |
| --- | --- |
| `PUT /statistics/like`, `DELETE /statistics/like` | Strict `{sourceType, sourceId}` DTOs; existing `{isLiked, likesCount}` response and guards. |
| `POST /statistics` | Source summary with views/current likes and projection/coverage status. |
| `GET /statistics/status` | Source-based actor state; anonymous callers receive false values. |
| `POST /statistics/series` | Source, `metric`, `granularity`, and UTC `from`/`to`; accepts up to six fractional digits and a maximum 366-day half-open range. |
| `POST /statistics/rankings` | Eligible game/review rankings with common presets or an explicit finite interval, filters, and `limit` 1–100 / `offset` 0–10,000. |
| `POST /statistics/view` | Durable `{sourceType, sourceId, viewId}` acceptance; returns HTTP 202 only after commit. Reuse `viewId` for one request's retries. |

Series and explicit ranking boundaries are normalized to UTC with microsecond precision. Intervals are `[from,to)`. Full interior hours/days use `metric_hour`; partial buckets use completed event facts with exact SQL boundaries. Hourly recent decay uses the hour's start as its representative time and a 24-hour half-life. Because this installation starts with the new ledger, history is complete from its first captured event: `completeSince` is null and `historyComplete` is true. `projectionLagSeconds` reports the oldest pending fact and `hasFailedEvents` reports failed facts independently.

`engagement-v1` assigns one point per accepted view and five points per actor's first known like on a target. Popular presets are rolling 1/7/30/90/180/365-day windows plus popular/all-time. Recent mode requires a finite interval; common recent pages use the rolling week. Rankings filter source eligibility and supported domain criteria in SQL before totals and pagination. Zero-score eligible sources remain, ordered by score then native ID. Review pins only move a review already inside the filtered eligible set. Page cache entries expire within 15 minutes and recheck the current eligible count and cached members before serving. Public pages are shared across users and anonymous callers; review `excludeOwn` requests retain actor-specific keys. Publishing a new prepared calculation invalidates older cached pages immediately. Views and current likes embedded in ranking pages may lag by up to 15 minutes.

Prepared popular rankings and recent-week rankings refresh every six hours at 00:00, 06:00, 12:00 and 18:00 UTC. Their rolling windows end at the published calculation time, so new engagement may take up to the next successful refresh to appear. Current eligibility is still checked when rankings are served. When a prepared key is missing, reads calculate scores from projected metrics without rebuilding the key or reserving another database connection; the scheduler publishes the prepared key on its next refresh.

Game pages read positive scores through the existing ranking index, then fill any remaining positions with eligible zero-score games in native ID order. Migration `1792960197571` adds a covering game index for eligibility and filtered pagination; deploy it before the updated ranking service. Views and current likes are fetched only for the selected page. The exact eligible total and cached-member checks still run inside the read transaction.

Public responses contain source IDs, aggregate values, and freshness/coverage metadata. They do not include actor IDs, raw event facts, or internal target IDs. Reads revalidate source/root/comment and current review/collection access. Query-time eligibility makes privacy reversible without rewriting retained facts.

`asOf` identifies the summary/series read time or the ranking calculation time.
History coverage is complete from installation; lag and failed projection facts
remain separate freshness signals.

Clients must switch together with the backend cutover. `/v1/statistics/status`
uses `sourceType`/`sourceId`; statistics row IDs and `/statistics/trending/*` and
`/statistics/queue/*` routes are retired. Keep the existing reaction requests and
responses. Use a fresh UUID for each navigation and retain it across view retries.
Examples (all timestamps are UTC):

```json
{"sourceType":"game","sourceId":1}
```

Send that body to `POST /v1/statistics` for a summary, or use the same fields as
query parameters for `GET /v1/statistics/status`. View, series and ranking bodies:

```json
{"sourceType":"post","sourceId":"123e4567-e89b-42d3-a456-426614174000","viewId":"123e4567-e89b-42d3-a456-426614174001"}
```

```json
{"sourceType":"game","sourceId":1,"metric":"views","granularity":"hour","from":"2026-10-25T10:20:00Z","to":"2026-10-25T12:10:00Z"}
```

```json
{"sourceType":"game","mode":"popular","period":"week","criteria":{"genres":[12]},"limit":20,"offset":0}
```

Rankings return `items`, `pagination`, `mode`, `definitionVersion`, `asOf`,
`effectiveFrom`/`effectiveTo` and coverage/freshness fields. An omitted mode uses
popular/week. Criteria allow only the existing ID/status/category/theme/mode/
platform/genre filters. Review filters use `gameId`, `authorId`, `excludeOwn` and
`reviewId`; unknown fields, formulas, ordering expressions and mixed selectors fail.

## Projection and recovery

The BullMQ `statistics-projection` queue contains only a recurring five-second `drain` tick, not one job per fact. Each tick admits at most 200 due facts using `FOR UPDATE SKIP LOCKED`, with one short transaction per fact so a persistence failure cannot block later facts. Metric effects and the fact's `done` state commit together. The projector never changes `likes_current`. Events remain uniquely keyed, so a lost tick or duplicate tick cannot duplicate effects.

Projection failures use durable attempt counts, next-attempt times, and a bounded error string. Five retries follow the initial attempt; poison facts then become `failed` without blocking later facts. `yarn statistics:projection diagnostics` reports pending/failed counts and oldest pending age. To retry one reviewed failed event, run `yarn statistics:projection rearm --event-id=<numeric-event-id>`; the command only re-arms a currently failed fact. Queue repeat-job history is bounded to the latest 100 completed and failed tick records; statistics facts and their projection state live in MySQL.

## Lifecycle and account cleanup

| Source kind | Creation/initialization | Removal and access validation |
| --- | --- | --- |
| game | IGDB game transaction/import callback | Native game lookup; imported game identity stays numeric. |
| post | `PostsService` transaction | Soft delete deactivates its target and descendant activity/comment targets; public reads require a non-deleted post. |
| review | `ReviewsService` transaction | Delete/report removal deactivates its target; public reads and rankings recheck collection visibility. |
| activity | Activity repository transaction/import | Parent post/review/collection eligibility is checked on every public read; cascading content removal deactivates descendants. |
| post comment | Existing comment/notification transaction | Comment/root lock validates ownership context; comment delete/report removal deactivates its target. |
| review comment | Existing comment/notification transaction | Review collection visibility and comment/root relationship are rechecked. |
| activity comment | Existing comment/notification transaction | Activity/root relationship and parent eligibility are rechecked. |

Profile deletion first removes that actor's engagement state in batches and subtracts only their active likes from `likes_current`; it anonymizes retained facts in bounded SQL batches. It does not invent unlike facts. The owning profile cleanup transaction also preserves the existing notification cleanup behavior. Target rows and facts are retained when a source is removed so historical aggregates do not depend on reverse foreign-key cascades.

Comment removal also tombstones its replies. Account removal inventories owned
sources and descendants before their cascades. Deleting a collection entry
invalidates its review and activities, including descendant comment targets,
through the same transaction as notification invalidation. Games have no account
owner or deletion endpoint; catalog updates preserve their targets.

## Fresh installation

The statistics tables come with the `InitialSchema` baseline (`yarn migration:run`). No statistics conversion or rebuild command is required: source creation initializes targets, the projector processes new facts automatically, and the ranking scheduler refreshes prepared scores. The optional `yarn statistics:projection diagnostics` and `rearm` commands are for inspecting or retrying failed runtime projection work; `--local` selects the disposable `igdb_sync_test` fixture.

## Ranking performance correction (2026-10-26)

Local measurements with approximately 302,000 eligible games, 20 items per page and an active catalog import:

| Request | Before | After |
| --- | --- | --- |
| Popular/month, offset 100 | 17.55 s | 397 ms |
| Popular/month, offset 10,000 | Not measured | 436 ms |
| Genre 12, offset 1,000 | 7.07 s | 144 ms |
| Genre 12, offset 10,000 | Not measured | 598 ms |
| Explore Next.js data request | 6.87 s in the supplied HAR | 564 ms |

Four concurrent ranking requests completed in 453 ms; twelve completed in 1.11 s. Combined genre/platform filters at offset 1,000 took 1.28 s. These are individual local measurements, not production latency percentiles. Exact eligible counts still scale with the filtered catalog size.

Validation passed: 10 statistics suites / 48 tests, 3 frontend consumer suites / 4 tests, `yarn build` and `git diff --check`. Coverage includes native-ID ties, positive-to-zero pagination, missing prepared scores, duplicate genre memberships, privacy, cache fallback and applying/reversing/reapplying the covering-index migration. The index was applied to the local application database; no production migration or benchmark was run.

## Verification record

The results below are historical checks from 2026-10-26, before offline
conversion/rebuild tooling was removed for the fresh-database scope. The initial
resume check passed 11 suites /
42 tests. Review then corrected required-FK source creation, isolated projection
persistence failures, fresh-install coverage, view suspension, cascade tombstones,
cache fallback/read consistency and legacy timestamp precision. The later checks
below cover those changes; overlapping results are not added together.

| Command / selection | Result | Scope |
| --- | --- | --- |
| `yarn test:statistics` | Passed: 12 suites / 46 tests, 32.26 seconds. | Historical run covering storage/targets, capture, projection rollback/replay/poison handling, source APIs, rankings, conversion, rebuild and required-FK content creation. |
| `yarn test:notifications` | Passed: 23 suites / 162 tests, 35.54 seconds. | Notification cutover, delivery, inbox/read state, transport, lifecycle, reactions, comments, reports and importer producers on replacement storage. The prior cutover baseline failure did not recur. |
| Focused consumers/contracts command below | Passed: 8 suites / 48 tests, 40.64 seconds. | Final reads/ranking snapshot/cache behavior, concurrent duplicate reactions, analytics rollback, strict/retired API contracts, recap half-open history, activity creation/idempotence, collection callers and game-create units. |
| `yarn jest --config test/igdb/jest-integration.json --runInBand --runTestsByPath test/igdb/igdb-game-import.integration-spec.ts` | Passed: 1 suite / 5 tests, 16.92 seconds. | Required-FK game/reference creation, reference races, transaction rollback, replay and counter preservation. |
| Focused Manticore command below | Passed: 1 suite / 3 selected tests, 17.67 seconds. | Real Manticore indexing/popularity, sparse zero defaults, native IDs, HTTP contracts and timestamp preservation. Six unrelated campaign cases were intentionally not selected. |
| `yarn build` | Passed. | Final Nest/TypeScript build. |
| `git diff --check` | Passed. | Final whitespace/conflict check. |
| `openspec validate rebuild-statistics-system --strict` | Passed. | Final planning/schema consistency. |

```bash
yarn jest --runInBand --testTimeout=120000 --runTestsByPath \
  src/statistics/statistics-ranking.integration.spec.ts \
  src/statistics/statistics-source-api.integration.spec.ts \
  src/statistics/statistics-reaction.integration.spec.ts \
  src/statistics/statistics-reaction.controller.spec.ts \
  src/recap/recap-create.statistics.integration.spec.ts \
  src/activities/activities-repository/activities-repository.service.spec.ts \
  src/collections/collections-entries/collections-entries.service.spec.ts \
  src/game/game-repository/create/game-repository-create.service.spec.ts
```

```bash
yarn jest --config test/search/jest-integration.json --runInBand \
  --runTestsByPath test/search/search-harness.integration-spec.ts \
  --testNamePattern='3\.2 |3\.3 |4\.1 '
```

The affected IGDB run first exposed duplicate reference reservations and then
fixture contamination: its reset reused target IDs still referenced by unrelated
domain tables. Insert-if-missing now discards only its unused reservation, and the
fixture uses and cleans independent `gi_` tables. The contaminated disposable
`igdb_sync_test` tables were cleared through the loopback-only test configuration
before the final consumer checks. An initially excessive prefix was shortened to
respect MySQL's identifier limit. These failures were corrected before the passing
IGDB result; no assertions were removed. The recap fixture now creates its own
coverage row and expects one addition inside the period, excluding the addition
exactly at the next day's boundary.

The fresh-start cleanup has not been tested. Historical full IGDB recovery/resource
failures from the earlier handoff were not reclassified as passes: those campaigns
are outside the revised acceptance scope and were not repeated. No workload,
production cutover or backup restore was executed. Capacity, memory/cache usage,
latency percentiles and a delivery-latency bound remain unmeasured. The disposable
service containers remain running.
