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

Each source row has one nullable `statisticsTargetId` with a unique source-side foreign key to `statistics_target`. The native source identity remains unchanged: games keep their numeric IDs and content keeps UUIDs. Target creation and source linking happen in the source transaction and initialize only the `likes_current` gauge.

The preparation schema permits null links for bounded conversion. Retirement makes
all seven source links required. New sources reserve the target before insertion;
updates preserve the existing link and imported-source timestamps.

| Store | Authority and meaning |
| --- | --- |
| `engagement_state` | Current actor/target like, durable `firstLikedAt`, and authenticated `lastViewedAt`. Anonymous views do not create actor state. |
| `statistics_event` | Append-only version-1 `view.recorded`, `like.added`, and `like.removed` facts. Only maintenance replay changes projection bookkeeping; account deletion may anonymize `actorUserId`. |
| `metric_total` | Projected historical views/additions/removals/first-like credits. `likes_current` is written synchronously with reaction state and never by the projector. |
| `metric_hour` | UTC hour totals for projected facts; edges of requested ranges are read from completed facts for exact inclusion. |
| `ranking_score` | Disposable, per-key prepared scores for `engagement-v1`. A key is replaced in one transaction. |
| `statistics_maintenance` | Durable bounded conversion/rebuild checkpoint, coverage boundary, backup reference, and correction report. |

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

Series and explicit ranking boundaries are normalized to UTC with microsecond precision. Intervals are `[from,to)`. Full interior hours/days use `metric_hour`; partial buckets use completed event facts with exact SQL boundaries. Hourly recent decay uses the hour's start as its representative time and a 24-hour half-life. `completeSince` is the earliest boundary for which retained history is complete; all-time results can still be incomplete. `projectionLagSeconds` reports the oldest pending fact and `hasFailedEvents` reports failed facts independently.

`engagement-v1` assigns one point per accepted view and five points per actor's first known like on a target. Popular presets are rolling 1/7/30/90/180/365-day windows plus popular/all-time. Recent mode requires a finite interval; common recent pages use the rolling week. Rankings filter source eligibility and supported domain criteria in SQL before totals and pagination. Zero-score eligible sources remain, ordered by score then native ID. Review pins only move a review already inside the filtered eligible set. Page cache entries expire within 15 seconds and recheck the current eligible count and cached members before serving.

Public responses contain source IDs, aggregate values, and freshness/coverage metadata. They do not include actor IDs, raw event facts, or internal target IDs. Reads revalidate source/root/comment and current review/collection access. Collection visibility changes take the statistics maintenance write guard; query-time eligibility makes privacy reversible without rewriting retained facts.

`asOf` identifies the summary/series read time or the ranking calculation time.
With no legacy gap, `completeSince` is null and `historyComplete` is true. After
conversion, all-time results and ranges starting before `completeSince` are
incomplete. Lag and failed projection facts remain separate from history coverage.

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

Projection failures use durable attempt counts, next-attempt times, and a bounded error string. Five retries follow the initial attempt; poison facts then become `failed` without blocking later facts. `yarn statistics:maintenance diagnostics` reports pending/failed counts and oldest pending age. To retry one reviewed failed event, run `yarn statistics:maintenance rearm --event-id=<numeric-event-id>`; the command only re-arms a currently failed fact and refuses while maintenance is active. Queue repeat-job history is bounded to the latest 100 completed and failed tick records; statistics facts and their projection state live in MySQL.

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

## Offline conversion, rebuild, and rollback

These commands are for a coordinated offline deployment. Stop application ingress and old statistics workers before starting conversion; the CLI checks for old queue workers, pauses `statistics-queue`, and leaves it paused. The database maintenance row blocks new statistics writers and collection visibility changes. Do not use `--local` against an application database; it selects the loopback `igdb_sync_test` fixture.

1. Take and verify the coordinated database backup; record its identifier for every command below.
2. Apply preparation migrations `1792960197568` and `1792960197569` after the integrated notification chain. With the new code, `yarn typeorm migration:run -d ./data-source.ts --transaction each` commits those preparations and deliberately refuses retirement until conversion/rebuild finish. Do not fake the retirement checkpoint. Run `yarn statistics:maintenance status` and confirm no unrelated operation is running.
3. Run `yarn statistics:maintenance convert --backup-reference=<backup-id> --batch-size=100`. Repeat with `--resume` after interruption, using the same backup ID. Conversion checkpoints source targets, surviving `user_like` rows, known `user_view` rows, and every state of the old `statistics-queue` separately from notification cutover checkpoints. It skips archived like jobs and does not replay notification conversion.
4. Review `yarn statistics:maintenance status`: target counts, imported facts, invalid-reference inventory, legacy counter corrections, and queue inventory must be understood before continuing.
5. Run `yarn statistics:maintenance rebuild --backup-reference=<backup-id> --batch-size=100`. Use `--resume` after interruption with the same backup ID. It rebuilds targets in bounded transactions from retained facts and current engagement state, then republishes common ranking keys before reopening writers.
6. Run the same migration command again to apply the tracked retirement migration only after conversion and rebuild report completion and source target links are non-null. Rebuild the search indexes against the updated schema with `docker compose -f docker-compose.prod.yml exec manticore /bin/bash /etc/manticoresearch/reindex.sh games users`; the script serializes index builds and rotates a running searchd. See the [search cutover runbook](search-cutover-runbook.md#2-stage-on-a-separate-index-volume). Then deploy the new writer/API version and resume traffic.

The conversion imports currently surviving likes as first-known retained additions; deleted historical likes cannot be reconstructed. Legacy view facts use their stored creation time; old queued view jobs use enqueue time as an identified approximation. Missing actors are anonymized, invalid references are counted with a bounded sample, and legacy counter differences are reported rather than fabricated into facts. `historyCompleteSince` marks the conversion boundary. Notification event, inbox, outbox, read, and `notification_cutover_*` rows are not converted or reset. Before traffic resumes, rollback is coordinated backup restore plus the previous application version. After new writes resume, that restore is not lossless.

## Verification record

Functional acceptance on 2026-10-26 reused the existing implementation and valid
results, following design section 11. The initial resume check passed 11 suites /
42 tests. Review then corrected required-FK source creation, isolated projection
persistence failures, fresh-install coverage, view suspension, cascade tombstones,
cache fallback/read consistency and legacy timestamp precision. The later checks
below cover those changes; overlapping results are not added together.

| Command / selection | Result | Scope |
| --- | --- | --- |
| `yarn test:statistics` | Passed: 12 suites / 46 tests, 32.26 seconds. | Storage/targets, capture, projection rollback/replay/poison handling, source APIs, rankings, conversion, rebuild and required-FK content creation. The affected reads/rankings/reactions/controller were checked again below after their final edits. |
| `yarn test:notifications` | Passed: 23 suites / 162 tests, 35.54 seconds. | Notification cutover, delivery, inbox/read state, transport, lifecycle, reactions, comments, reports and importer producers on replacement storage. The prior cutover baseline failure did not recur. |
| Focused consumers/contracts command below | Passed: 8 suites / 48 tests, 40.64 seconds. | Final reads/ranking snapshot/cache behavior, concurrent duplicate reactions, analytics rollback, strict/retired API contracts, recap half-open history, activity creation/idempotence, collection callers and game-create units. |
| `yarn jest --config test/igdb/jest-integration.json --runInBand --runTestsByPath test/igdb/igdb-game-import.integration-spec.ts` | Passed: 1 suite / 5 tests, 16.92 seconds. | Required-FK game/reference creation, reference races, transaction rollback, replay and counter preservation. |
| Focused Manticore command below | Passed: 1 suite / 3 selected tests, 17.67 seconds. | Real Manticore indexing/popularity, sparse zero defaults, native IDs, HTTP contracts and timestamp preservation. Six unrelated campaign cases were intentionally not selected. |
| `yarn jest --runInBand --testTimeout=120000 --runTestsByPath src/statistics/statistics-legacy-conversion.integration.spec.ts` | Passed: 1 suite / 1 test, 9.21 seconds. | Final conversion preserves six-digit timestamps, resumes/deduplicates facts and queue inventory, rebuilds/retire guards and preserves pending old notification identities. |
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

No functional acceptance blocker remains. Historical full IGDB recovery/resource
failures from the earlier handoff were not reclassified as passes: those campaigns
are outside the revised acceptance scope and were not repeated. No workload,
production cutover or backup restore was executed. Capacity, memory/cache usage,
latency percentiles and a delivery-latency bound remain unmeasured. The existing
`statistics:workload` utility is optional future work, never an acceptance gate.
The existing disposable service containers remain running.
