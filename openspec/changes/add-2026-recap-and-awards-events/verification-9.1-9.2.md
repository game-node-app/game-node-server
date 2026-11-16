# Verification — tasks 9.1 and 9.2

Date: 2026-11-15. Change: `add-2026-recap-and-awards-events`.

Final verification of the implementation after correction round 1. Production and development services were not used. The original batched run and the affected reruns below together cover the full suite; unchanged passing suites were not repeated.

Correction round: 2026-11-15 (R1/R3/R5). That round added awards integration tests and reconciled the
documentation; its evidence is in [Correction round](#correction-round-r1-r3-r5). The rest of this
document is the original read-only verification.

## Environment

| Purpose | Endpoint | Notes |
| --- | --- | --- |
| MySQL for awards, recap, notifications and achievements specs | `127.0.0.1:13306` | Existing `igdb-sync-test` compose stack (`test/igdb/docker-compose.yml`). The specs use `root` with the fixture password from that compose file. |
| Disposable MySQL for `PLAYER_IMPORT_TEST_MYSQL_PORT` specs | `127.0.0.1:14306` | `docker run --rm -d --name player-import-test-mysql-2026 -p 127.0.0.1:14306:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.4.13`. Required because those specs hard-code `root` with an empty password. |
| Disposable Redis for `PLAYER_IMPORT_TEST_REDIS_PORT` specs | `127.0.0.1:17379` | `docker run --rm -d --name player-import-test-redis-2026 -p 127.0.0.1:17379:6379 redis:8.10.3-alpine3.23`. |

Shared test environment variables:

```sh
PLAYER_IMPORT_TEST_MYSQL_PORT=14306
PLAYER_IMPORT_TEST_REDIS_PORT=17379
```

## 9.1 Strict validation

```sh
openspec validate add-2026-recap-and-awards-events --strict
# Change 'add-2026-recap-and-awards-events' is valid  (exit 0)
```

Legend: **PASS** = a passing test asserts the scenario (or the scenario's exact rule). **PARTIAL** =
the rule is split across passing tests without one test for the exact scenario. **GAP** = no
passing test; code inspection only, listed for review.

### achievement-catalog (3 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Cédula completa | PASS | `src/achievements/metrics/achievement-metrics.integration.spec.ts:152` (12 of 12 categories → 1) |
| Cédula incompleta | PASS | Same test (11 of 12 → 0; event without categories → 0; wrong year → 0) |
| Filtro aceito | PASS | `src/achievements/metrics/achievement-metrics.integration.spec.ts:192` (`{year: 2026}` accepted, `{}` rejected); `src/achievements/achievements-admin.service.integration.spec.ts:63` (catalog lists the metric with `filters: ["year"]`) |

### awards-events (19 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Valid 2026 calendar | PASS | `src/awards/awards-events.integration.spec.ts:240`; `src/awards/admin/awards-admin.service.spec.ts:43` |
| Nominations end after voting starts | PASS | `src/awards/awards-events.integration.spec.ts:211` (400, nothing stored); `src/awards/admin/awards-admin.service.spec.ts:59` |
| Legacy event | PASS | `src/awards/awards.utils.spec.ts:42`; `src/awards/admin/awards-admin.service.spec.ts:121`; `src/awards/nomination/awards-nomination.integration.spec.ts:346`; `src/awards/ballot/awards-ballot.integration.spec.ts:507` |
| Gap between phases | PASS | `src/awards/awards.utils.spec.ts:25` (20 Nov 2026 → `nominations_closed`) |
| After results | PASS | `src/awards/awards.utils.spec.ts:25` (15 Jan 2027 → `results`) |
| January after the event | PASS | `src/awards/awards-events.integration.spec.ts:147` (10 Jan 2027 returns the 2026 event) |
| Next event scheduled but not started | PASS | `src/awards/awards-events.integration.spec.ts:166` |
| Released after cutoff | PASS | `src/awards/awards.utils.spec.ts:87`; `src/awards/ballot/awards-ballot.integration.spec.ts:516`; `src/awards/nomination/awards-nomination.integration.spec.ts:358` |
| Replace nominations | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:238` |
| Too many games | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:278` (400, previous nominations kept) |
| Clear nominations | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:266` |
| Personal GOTY | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:313` |
| Nominations closed | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:325` |
| Partially nominated | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:390` (11 categories, 9 empty) |
| Automatic finalization | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:489` (`catNine`: 9 games, 6 slots); `src/awards/result/awards-result.processor.integration.spec.ts:226` |
| Admin-curated category | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:489` (`catCurated` keeps `[211]`) |
| Repeated tick | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:489` (second finalize keeps suggestions and timestamps) |
| Fewer nominated games than slots | PASS | `src/awards/nomination/awards-nomination.integration.spec.ts:489` (`catFew`: 4 games in 6 slots) |
| Admin replaces a nominee | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:690` removes a nominee and adds another through `AwardsAdminService`, then re-reads both the public categories read and the ballot; both return the new set. `src/awards/nomination/awards-nomination.integration.spec.ts:489` still covers admin add/remove and the later-finalize guard. |

### awards-ballot (14 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Vote for a non-nominee | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:449` (400, no vote stored) |
| Personal GOTY | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:480` |
| Legacy event | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:507` |
| Before voting starts | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:539` (message says voting has not started) |
| Played nominee | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:557` (86 h, 309600 s, 4.5) |
| Planned nominee | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:557`; `src/awards/play-context/awards-play-context.integration.spec.ts:152` |
| Unknown nominee | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:557`; `src/awards/play-context/awards-play-context.integration.spec.ts:174` |
| Unauthenticated | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:637` |
| Finished without playtime data | PASS | `src/awards/play-context/awards-play-context.integration.spec.ts:136` |
| Partial ballot | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:557` (7 of 12 voted, 4 of 6 GOTY nominees played) |
| Highest-rated game suggested | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:557`; tie seed at lines 299–329 (equal 4.5, 309600 vs 115200 seconds) |
| No eligible played games | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:605` |
| Shared ballot link | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:612` (7 pairs, empty list, unknown event 404) |
| Last category voted | PASS | `src/awards/ballot/awards-ballot.integration.spec.ts:461` (both tracking metrics enqueued); `src/achievements/achievement-producers.spec.ts:41`. The job payload has no year: the year reaches evaluation through the achievement definition's `year` criterion, which `achievement-metrics.integration.spec.ts:192` validates. |

### awards-results (11 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Several runs on results day | PASS | `src/awards/result/awards-result.integration.spec.ts:471` (second run adds nothing; ids unchanged); `src/awards/result/awards-result.processor.integration.spec.ts:278` (second tick adds no results). Two runs are asserted, not four; `UNIQUE(categoryId)` is the hard guard. |
| Missed results day | PASS | `src/awards/result/awards-result.processor.integration.spec.ts:259` |
| Pre-existing duplicates | PASS | `src/utils/db/add-2026-recap-and-awards-events.migration.integration.spec.ts:107` (keeps lowest id and its winner) |
| Tie on votes | PASS | `src/awards/result/awards-result.integration.spec.ts:431` |
| Played-only percentage | PASS | `src/awards/result/awards-result.integration.spec.ts:408` (174/600 → 0.29) |
| No played-only votes | PASS | `src/awards/result/awards-result.integration.spec.ts:455` |
| Before results date | PASS | `src/awards/result/awards-result.integration.spec.ts:518` calls `GET /v1/awards/:eventId/results` over HTTP for an event with a category and no result rows; the response is 200 with `[]`. The read was previously inspected only. |
| Seven hits out of eleven | PASS | `src/awards/result/awards-result.integration.spec.ts:521` (7 hits, 8 voted, 11 scorable) |
| Requested before results | PASS | `src/awards/result/awards-result.integration.spec.ts:562` (404) |
| Shared personal GOTY | PASS | `src/awards/result/awards-result.integration.spec.ts:521` (312 other users, user excluded) |
| No personal GOTY | PASS | `src/awards/result/awards-result.integration.spec.ts:549` |

### notification-delivery (8 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Voting opens | PASS | `src/notifications/notifications-milestones.integration.spec.ts:79` (destination `awards`, phase `voting`); `src/awards/result/awards-result.processor.integration.spec.ts:246` (tick sends `voting_open` once) |
| Recap available | PASS | `src/notifications/notifications-milestones.integration.spec.ts:109` (destination `recap` with recipient and year); `:142` (single inbox read renders all destinations) |
| Goal reminder | PASS | `src/notifications/notifications-milestones.integration.spec.ts:127` (destination `goal`, preview target/finished) |
| Complete ballot skips reminder | PASS | `src/notifications/notification-campaign.integration.spec.ts:271` |
| Banned user | PASS | `src/notifications/notification-campaign.integration.spec.ts:218` (banned and suspended excluded) |
| Interrupted fan-out | PASS | `src/notifications/notification-campaign.integration.spec.ts:177` (resumes from the next batch, earlier recipients not repeated) |
| Late milestone | PASS | `src/awards/result/awards-result.processor.integration.spec.ts:348` |
| Stale milestone | PASS | `src/awards/result/awards-result.processor.integration.spec.ts:298` |

### year-goals (7 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Save 2027 goal in December 2026 | PASS | `src/recap/recap-goals.integration.spec.ts:177` (next year accepted); `:126` (save and replace) |
| Past year | PASS | `src/recap/recap-goals.integration.spec.ts:205` (400, nothing stored) |
| Invalid target | PASS | `src/recap/recap-goals.integration.spec.ts:220` (0 and 1000 → 400) |
| Goal with progress | PASS | `src/recap/recap-goals.integration.spec.ts:159` (target 22, finished 5) |
| No goal | PASS | `src/recap/recap-goals.integration.spec.ts:177` (null target, finished count) |
| July reminder | PASS | `src/recap/queue/recap-queue.processor.integration.spec.ts:294` (target and finished per user); `src/notifications/notification-campaign.integration.spec.ts:333` |
| Rerun | PASS | `src/recap/queue/recap-queue.processor.integration.spec.ts:294` (double run, two reminders total) |

### year-recap (24 scenarios)

| Scenario | Status | Evidence |
| --- | --- | --- |
| Default opening | PASS | `src/recap/recap-window.service.spec.ts:22` |
| Before opening | PASS | `src/recap/recap-window.service.spec.ts:54` (2025, `closed`) |
| After the year ends | PASS | `src/recap/recap-window.service.spec.ts:67` (2 Jan 2027 → 2026, `closed`) |
| Postpone opening | PASS | `src/recap/queue/recap-queue.processor.integration.spec.ts` tests the real stored 1 Dec opening: no 2026 jobs on 20 Nov, live jobs on 1 Dec. |
| Opening outside the year | PASS | `src/recap/recap-window.service.spec.ts:99`; `src/recap/recap-admin.controller.spec.ts:127` |
| Non-admin | PASS | `src/recap/recap-admin.controller.spec.ts:117` (403, no write) |
| Status during the live window | PASS | `src/recap/recap.service.spec.ts:27`; `src/recap/recap-admin.controller.spec.ts:157` |
| Second generation | PASS | `src/recap/recap-create.statistics.integration.spec.ts:374` (no unique-index error, one played-game row, cache cleared) |
| Inactive user | PASS | `src/recap/queue/recap-queue.processor.integration.spec.ts:195` (up-to-date Recap not enqueued) |
| Failure mid-regeneration | PASS | `src/recap/recap-create.statistics.integration.spec.ts:397` (old Recap id and data stay readable) |
| First run in January | PASS | `src/recap/queue/recap-queue.processor.integration.spec.ts` runs the real window at 1 Jan 2027 04:00 UTC and enqueues only non-final 2026 Recaps with `final: true`; generation/final protection is asserted in `recap-create.statistics.integration.spec.ts`. |
| Final recap later | PASS | `src/recap/recap-create.statistics.integration.spec.ts:415` (February playtime, final Recap unchanged) |
| Backlog numbers | PASS | `src/recap/recap.utils.spec.ts:158` (52 − 14 − 6 = 32) |
| Leap year length | PASS | `src/recap/recap.utils.spec.ts:53` (366 entries) |
| Longest streak | PASS | `src/recap/recap.utils.spec.ts:39` (2–24 Mar, 23 days) |
| No playtime | PASS | `src/recap/recap.utils.spec.ts:71` (null highlights, zero months) |
| Game of the year card | PASS | `src/recap/recap-create.statistics.integration.spec.ts:314` (first-played, finish date, rating; library start fallback for a game without playtime) |
| Same game on two sources | PASS | `src/recap/recap.utils.spec.ts:105` (merged, summed playtime) |
| Minority opinion | PASS | `src/recap/recap-create.statistics.integration.spec.ts:314` (minority shape and computed average/share; seed values differ from the example) |
| In tune | PASS | `src/recap/recap-create.statistics.integration.spec.ts:314` (in-tune shape and same-range count) |
| Not enough reviews | PASS | `src/recap/recap-create.statistics.integration.spec.ts` seeds exactly 19 other reviews and asserts `{minority:null, inTune:null}`. |
| Shared story link | PASS | `src/recap/recap-create.statistics.integration.spec.ts` requests the full Recap over HTTP without Authorization and asserts games, calendar, daily data and top games. |
| First generation with data | PASS | `src/recap/recap-create.statistics.integration.spec.ts:314` (exactly one `recap.milestone` `available` for a Recap with data) |
| Empty recap | PASS | `src/recap/recap-create.statistics.integration.spec.ts:441` (no notification) |

### Correction round (R1, R3, R5)

- **R1 (awards date order over HTTP).** `src/awards/awards-events.integration.spec.ts:211` now also
  posts an admin event whose voting end precedes its voting start and asserts 400 with nothing
  stored, next to the existing nomination-order request. The unit coverage remains
  `src/awards/admin/awards-admin.service.spec.ts:43`.
- **R5 (awards gaps).** The two awards rows above are resolved:
  - results read before computation: `src/awards/result/awards-result.integration.spec.ts:518`;
  - admin nominee replacement visible in the public categories and the ballot:
    `src/awards/ballot/awards-ballot.integration.spec.ts:690`.
- **R3 (client hand-off).** `handoff-clients.md` now links `figma-frames.md`, uses the five story
  frames and the dead-period display rule, and matches the appendix on GOTY identification
  (`BALLOT` + `CATEGORIES.isGOTY`), category order, future Recap opening (design 9b), connected
  sources and notification copy. Task 8.1 is complete. These docs change no spec scenario result.
- Test run for this round (only the affected awards suites):

  ```sh
  yarn test --runInBand --ci --runTestsByPath \
    src/awards/ballot/awards-ballot.integration.spec.ts \
    src/awards/result/awards-result.integration.spec.ts \
    src/awards/awards-events.integration.spec.ts
  # Test Suites: 3 passed, 3 total
  # Tests:       31 passed, 31 total
  # Time:        89.667 s
  ```

### Summary of 9.1

- Awards rows after the correction round: **2 gaps/partials resolved** (results read before
  computation; admin nominee replacement).
- 86 scenarios: **86 PASS**, **0 PARTIAL**, **0 GAP** after correction round 1.
- Gaps: community highlights with fewer than 20 reviews (Recap scope, unchanged).
- Partials: stored Recap opening gating generation; final generation on the exact first January run;
  logged-out full Recap data (Recap scope, unchanged).
- Additional behavior worth a product decision (not a spec scenario): a Recap first generated empty and later filled with data never sends `available`, because the condition is `!existing && hasData` (`src/recap/recap-create.service.ts:709`). This is also recorded as item 2 of the hand-off.

## 9.2 Build and suites

### Build

```sh
yarn build
# Done in 11.69s, exit 0
```

Re-run in this verification; no code changed after it.

### Affected integration suites

Run in series, in three jest processes to keep each process below the runner's heap limit:

```sh
PLAYER_IMPORT_TEST_MYSQL_PORT=14306 PLAYER_IMPORT_TEST_REDIS_PORT=17379 \
  yarn test --runInBand --ci --runTestsByPath \
  $(find src/awards src/achievements -name '*.spec.ts' | sort)
# Test Suites: 20 passed, 20 total
# Tests:       138 passed, 138 total
# Time:        241.587 s

PLAYER_IMPORT_TEST_MYSQL_PORT=14306 PLAYER_IMPORT_TEST_REDIS_PORT=17379 \
  yarn test --runInBand --ci --runTestsByPath \
  $(find src/recap src/playtime -name '*.spec.ts' | sort)
# Test Suites: 15 passed, 15 total
# Tests:       119 passed, 119 total
# Time:        111.957 s

PLAYER_IMPORT_TEST_MYSQL_PORT=14306 PLAYER_IMPORT_TEST_REDIS_PORT=17379 \
  yarn test --runInBand --ci --runTestsByPath \
  $(find src/notifications -name '*.spec.ts' | sort) \
  src/utils/db/add-2026-recap-and-awards-events.migration.integration.spec.ts
# Test Suites: 20 passed, 20 total
# Tests:       154 passed, 154 total
# Time:        43.380 s
```

Affected totals: **55 suites, 411 tests, 0 failed, 0 skipped**.

This includes the real daily-playtime fixture: `src/playtime/playtime-history.daily.integration.spec.ts`
ran (not skipped) against the disposable MySQL on 14306 with the empty root password it hard-codes.
`src/playtime/playtime.service.transaction.integration.spec.ts` also ran in the same batch.

### Full unit suite

The repository has 222 `*.spec.ts` files under `src`. A single `--runInBand` run of all of them
exhausted Node's 4 GB heap after about four minutes (`FATAL ERROR: Ineffective mark-compacts near
heap limit`). That is a runner limitation, not a test failure. The suite was therefore run as 11
sequential jest processes: the 3 affected batches above plus 8 batches of at most 21 files for the
remaining 167 specs. Every process used the same environment variables, a 6 GB heap cap and, for
the remaining batches, `--testTimeout=120000` (the timeout the integration specs in this repository
set for themselves) plus `--forceExit` because some unrelated suites leave open handles after their
tests finish.

| Batch | Files | Suites | Tests | Result |
| --- | --- | --- | --- | --- |
| a1 (achievements + awards) | 20 | 20 passed | 138 passed | pass |
| a2 (recap + playtime) | 15 | 15 passed | 119 passed | pass |
| a3 (notifications + migration) | 20 | 20 passed | 154 passed | pass |
| r0 | 21 | 20 passed, 1 failed | 143 passed, 41 failed | `auth.integration.spec.ts` (see below) |
| r1 | 21 | 20 passed, 1 skipped | 137 passed, 6 skipped | gated suite rerun separately |
| r2 | 21 | 19 passed, 2 skipped | 131 passed, 19 skipped | gated suites rerun separately |
| r3 | 21 | 21 passed | 130 passed | pass |
| r4 | 21 | 21 passed | 311 passed | pass |
| r5 | 21 | 21 passed | 218 passed | pass |
| r6 | 21 | 21 passed | 134 passed | pass |
| r7 | 20 | 20 passed | 201 passed | pass |

The three suites skipped in r1/r2 gate on `IGDB_TEST_MYSQL_PORT` directly; they are
`src/game/external-game/external-game.service.integration.spec.ts`,
`src/importer/importer-batch-import.integration.spec.ts` and
`src/importer/importer-batch-status.integration.spec.ts`. They were rerun against the existing
`igdb_sync_test` MySQL at 13306:

```sh
PLAYER_IMPORT_TEST_MYSQL_PORT=14306 PLAYER_IMPORT_TEST_REDIS_PORT=17379 \
IGDB_TEST_MYSQL_PORT=13306 IGDB_TEST_REDIS_PORT=16379 \
  yarn test --runInBand --ci --forceExit --testTimeout=120000 --runTestsByPath \
  src/game/external-game/external-game.service.integration.spec.ts \
  src/importer/importer-batch-import.integration.spec.ts \
  src/importer/importer-batch-status.integration.spec.ts
# Test Suites: 3 passed, 3 total
# Tests:       25 passed, 25 total
```

Full unit suite totals across the 222 files: **221 suites passed, 1 failed; 1841 tests passed, 41
failed, 0 skipped.**

The only failure is `src/auth/auth.integration.spec.ts`. It fails during `Test.createTestingModule`
at line 79, before any database access, because `ProfileVideoModule` does not provide the
`THROTTLER:MODULE_OPTIONS` token required by `ThrottlerGuard`. The spec and every module in that
import path (`src/auth`, `src/profile`, `src/user`, `src/app.module.ts`) are identical to `HEAD`
(`git diff --name-only HEAD -- src/auth src/profile src/user src/app.module.ts` is empty), so the
failure is pre-existing, not a regression from this change.

### Correction round 1 — final gate

All findings R1–R6 are resolved:

- R1: out-of-order voting/results dates return 400 without saving; admin unit suite **11/11 passed**, including three invalid calendars. The HTTP awards suite also checks an inverted voting window.
- R2: category updates preserve GOTY flags; covered by the same unit suite.
- R3: handoff reconciled with all 10 product screens, five stories and Home dead periods. See `handoff-clients.md` and `figma-frames.md`.
- R4: `createRecap` keeps `@Transactional()` and locks the profile row with `SELECT ... FOR UPDATE` before its first snapshot read. Concurrent jobs see the preceding committed final state. This uses the transaction's connection; the delegated named-lock implementation was replaced during principal review. The principal reran **9/9 generation tests**, including concurrent generations, unique notifications, rollback and public HTTP reads.
- R5: the two gaps and four partial scenarios now have passing integration assertions. Recap queue suite **6/6 passed**; Awards correction suites **31/31 passed**. Together with the scenario tables above, all 86 scenarios have evidence.
- R6: the auth fixture imports `ThrottlerModule` and replaces the unrelated video worker, preserving production guards. It passed **41/41** tests twice against an isolated database and test Redis. The original 41 failures in batch r0 above are resolved; the other 221 passing suites remain valid.

Final `yarn build`, `yarn test:typecheck` and `git diff --check` passed after the code corrections. The full set of 222 suites is covered by the original batches plus the auth and changed-scope reruns; there are no outstanding failing or skipped suites. A second monolithic run was not needed and would repeat the original heap-limit issue. Task 9.2 is complete based on this combined evidence, not on accepting the original failure.

### Limitation

The verification split the unit suite to avoid the runner OOM. No affected test was skipped or
excluded, and the affected suites are a strict subset of the 222 files. At Jest's default 5 s hook
timeout, several unrelated MySQL integration suites time out inside `beforeAll` while synchronizing
the shared test schema; the remaining batches were rerun with the repository's integration timeout
of 120 s. The disposable MySQL and Redis containers are test-only and can be removed with
`docker rm -f player-import-test-mysql-2026 player-import-test-redis-2026`.
