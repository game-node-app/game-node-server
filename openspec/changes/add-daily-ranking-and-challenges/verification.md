# Verification: add-daily-ranking-and-challenges

Regenerated after the table-based ranking rewrite: the cached list rows are gone, so every row below was
re-checked against the tests that exist now. Commands were run in this checkout on 2026-11-16/17; the
quoted Jest names are the full names recorded in the Jest JSON report of the passing 16-suite run
(`--json --outputFile`), not names copied from the previous verification.

## Evidence run

| Command | Result |
| --- | --- |
| `openspec validate add-daily-ranking-and-challenges --strict` | `Change 'add-daily-ranking-and-challenges' is valid` (exit 0) |
| `pnpm test:typecheck` | exit 0 (10.6 s) |
| `pnpm build` | exit 0 (12.9 s) |
| `pnpm test --runInBand --testTimeout=120000 --testPathPatterns='src/daily/\|src/auth/lockout-limit'` | 16/16 suites, 137/137 tests passed (42.8 s) |
| `pnpm test --testTimeout=120000 --testPathIgnorePatterns='integration.spec.ts'` (unit suites) | 170 passed, 1 skipped, 2 failed of 173 suites; 1466 passed, 14 skipped, 4 failed of 1484 tests (590.8 s). Both failures reproduce on `HEAD` 04ae93d, see Gaps. |
| `pnpm test --runInBand --testTimeout=120000` (full suite) | Aborted by `RangeError: Maximum call stack size exceeded` in `src/auth/auth.integration.spec.ts`; reproduced on `HEAD`. No suite result to report. |
| Migration chain (`runMigrations` from `dist/src/migrations` on a fresh MySQL 8.4.13) | 20/20 migrations applied, including `AddDailyRankingAndChallenges1795400000000` (exit 0) |
| Boot check (`node dist/src/main`, `SERVER_PORT=5056`) | See "Boot check" below: no provider errors, scheduler boot duties ran, daily reads 200 |

The daily run above includes `src/auth/lockout-limit.spec.ts` and the three daily ranking specs, which are
the only specs that reference `AuthService.getLockedUserIds` (`grep -rln getLockedUserIds src`).

### Boot check (task 6.2)

- Scratch MySQL database `daily_verify_scratch` on the test MySQL `127.0.0.1:13306`, scratch Redis DB 5 on
  `127.0.0.1:16379`; `SERVER_PORT=5056` (port 5000 was left alone). `node dist/src/main`, current build.
- Schema: TypeORM `synchronize` on the scratch DB (same approach as
  `test/notifications/notification-test-harness.ts`), then the three better-auth migrations
  (`ReplaceSupertokensWithBetterAuth`, `AddMcpOAuthProvider`, `WidenOAuthClientReferences`) applied by
  hand. `synchronize` does not create the better-auth tables, and the first boot without them returned 500
  (`SchemaMismatchError: Missing tables user, session, …`) from `GET /v1/daily` because `AuthGuard` reads
  the session. That is a scratch-schema gap, not an app error.
- Seeded one game, one profile, today's Cover puzzle and one ranked result for that profile, then removed
  `daily_ranking_entry`/`daily_ranking_snapshot` and the snapshot marker so the boot duties had work.
- Log: `[InstanceLoader] DailyModule dependencies initialized`, `Nest application successfully started`;
  zero `Nest can't resolve dependencies`, zero circular-dependency messages, zero `Daily ranking rebuild
  failed` / `snapshot failed` / `puzzle generation failed`. The only two error records are
  `IgdbCatalogSchedulerService` (`Could not find any entity of type "IgdbCatalogState"` — the scratch DB has
  no catalog state row), outside the daily module and expected on an empty scratch schema.
- Scheduler boot duties ran: `ensurePuzzles` ran (33 expected `No eligible game left…` warnings for the
  scratch catalog's empty game pool, no errors), `rebuildIfEmpty` wrote 8 `daily_ranking_entry` rows
  (today/week/month/all × overall/cover) for the seeded ranked result, `snapshotIfNeeded` set
  `daily:ranking:snapshot:2026-11-16` (no snapshot rows: that player had no result before today).
- `GET /v1/daily` → 200 `{"date":"2026-11-16","nextResetAt":"2026-11-17T03:00:00.000Z","weekly":null,"puzzles":[{"id":1,"mode":"cover","number":1,"date":"2026-11-16","maxAttempts":6}]}`;
  `GET /v1/daily/ranking?period=week` → 200 with the seeded player at position 1; `GET /v1/health` → 200.
- Boot rewrote `server_swagger.json`: sha256 before boot `accbf6a2008eb50b213a3a4691ae11fb6f69e157900959954c93c1c29ff3f62c`
  and after boot the same value (byte-identical).
- Cleanup: app stopped (`SIGTERM`, exit 143), scratch database dropped, Redis DB 5 flushed (0 keys), no
  listener on port 5056 and no leftover `dist/src/main` process. The separate `daily_migration_chain`
  database used for the migration-chain check was dropped as well.

## daily-ranking

| Scenario | Evidence | Status |
| --- | --- | --- |
| Finished on the puzzle day | `daily.service.integration.spec.ts` :: DailyService counted results on MySQL counts a same-day daily finish once, even after a reopen | PASS |
| Finished after midnight | `daily.service.integration.spec.ts` :: DailyService counted results on MySQL does not count a daily finish after midnight (yesterday's puzzle played today → `ranked=false`, 0 points) | PASS |
| Archive play | `daily.service.integration.spec.ts` :: DailyService counted results on MySQL does not count an archive finish | PASS |
| Imported guest result | `daily.service.integration.spec.ts` :: DailyService counted results on MySQL never counts an imported result, even on the puzzle day | PASS |
| Cover third attempt | `daily.constants.spec.ts` :: daily points scores a win by the attempts used, in tenths (Cover attempts 1/3/6 = 6/4/1 points) | PASS |
| Skip counts as an attempt | `daily.constants.spec.ts` :: daily points scores a win by the attempts used, in tenths (Artwork, one skip + correct = 2 attempts = 5 points) | PASS |
| Specs boundaries | `daily.constants.spec.ts` :: daily points scores a win by the attempts used, in tenths (Specs attempts 1 and 10 = 6 and 0.6 points) | PASS |
| Specs hint | `daily.constants.spec.ts` :: daily points scores a win by the attempts used, in tenths (hint after five guesses, 7 attempts = 2.4 points) | PASS |
| Loss | `daily.constants.spec.ts` :: daily points scores no points for a loss or unfinished play; `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL writes one absolute aggregate per partition, ignoring unranked and weekly rows (a counted loss is `played=1`, 0 points) | PASS |
| All four modes won | `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL adds the bonus only when all four modes were won, never to a mode row (overall today = 174 tenths + 20 bonus) | PASS |
| One mode lost | `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL adds the bonus only when all four modes were won, never to a mode row (the `three` player: 150 tenths, no bonus) | PASS |
| Mode ranking | `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL adds the bonus only when all four modes were won, never to a mode row (`today:specs` = 24 without the bonus) | PASS |
| Historical same-day win | `add-daily-ranking-and-challenges.migration.integration.spec.ts` :: AddDailyRankingAndChallenges migration runs up, adds the schema and backfills same-day results only (fixtures include 23:59 São Paulo = 02:59 UTC next day); boot check above rebuilt entries from an existing ranked result | PASS |
| Historical archive play | `add-daily-ranking-and-challenges.migration.integration.spec.ts` :: AddDailyRankingAndChallenges migration runs up, adds the schema and backfills same-day results only (00:01 São Paulo = 03:01 UTC does not count); :: runs down and restores the old schema, keeping the rows | PASS |
| Week on a Wednesday | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking includes only puzzles inside each period and reports the period end (week = Monday..today, Sunday `endsAt`); :: computes position changes only against the current period so far (fixed Wednesday 2026-03-11) | PASS |
| All time | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking includes only puzzles inside each period and reports the period end (`all` = every row, `endsAt: null`) | PASS |
| Cover filter | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking includes only puzzles inside each period and reports the period end (mode=cover point totals per period); :: builds overall and mode rows with the documented fields | PASS |
| Invalid filter | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking rejects an unknown period, mode, scope or out of range page (400 for period, mode, scope, limit 0/101, offset -1) | PASS |
| Player who only lost | `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL writes one absolute aggregate per partition, ignoring unranked and weekly rows (a counted loss writes a 0-point entry with `played=1`), and the read path has no points filter (`entryFilter` + page query in `daily-ranking.service.ts`); no HTTP read test seeds a loss-only player | PARTIAL |
| Banned player | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking never gives a banned player a previous position (yesterday's 10,000-point first player absent, `stayed` first); `lockout-limit.spec.ts` :: AuthService.getLockedUserIds returns permanent bans and active suspensions, ignoring expired ones | PASS |
| Equal points | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking orders ties by attempts, last finish and user id in SQL | PASS |
| Equal points and attempts | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking orders ties by attempts, last finish and user id in SQL (earlier finish first, then sorted user id) | PASS |
| Following scope | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking limits the following scope to the viewer and followed players (followed A, B and viewer at 1–3; the stranger is absent) | PASS |
| Following without session | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking limits the following scope to the viewer and followed players (401 assertion) | PASS |
| Overall row | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking builds overall and mode rows with the documented fields (`modePoints`, `currentStreak`; `wins` absent) | PASS |
| Mode row | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking builds overall and mode rows with the documented fields (`wins`, `averageAttempts`, `bestStreak`; `modePoints` absent) | PASS |
| Win rate | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking builds overall and mode rows with the documented fields (1 win / 1 loss → 50, same `wins / played × 100` formula as the 4/5 = 80 example) | PASS |
| Player moved up | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking reports positions moved since yesterday and new players (+1 / -1; the +3 example is the same computation) and :: computes position changes only against the current period so far | PASS |
| New player | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking reports positions moved since yesterday and new players (`"new"`) and :: computes position changes only against the current period so far (every row is `"new"` on a Monday and on the 1st) | PASS |
| Not played yet today | `daily-ranking.utils.spec.ts` :: computeStreaks keeps the streak alive when the player has not played today; `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking keeps a streak alive until yesterday and reports 0 when it is broken | PASS |
| Missed a day | `daily-ranking.utils.spec.ts` :: computeStreaks breaks when the last win was two days ago; `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking keeps a streak alive until yesterday and reports 0 when it is broken | PASS |
| Viewer outside the top 100 | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking pages rows, counts players and points the viewer to the top 100 (viewer 101st, `pointsToTop100` = 1; same gap computation) | PASS |
| Guest | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking serves guests the list without a viewer row (`viewer: null`, `pointsToTop100: null`) | PASS |
| Second page | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking pages rows, counts players and points the viewer to the top 100 (offset 10, limit 10, first row position 11, 10 rows, total 101) | PASS |
| Another player's new result | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking shows another player's finish on the next read (no list cache remains; the next read returns the new 6-point row) | PASS |
| Counted finish | `daily-ranking-summary.integration.spec.ts` :: Daily play ranking summary over HTTP (integration) reports points and the week position after a counted finish (6 points for a first-attempt Keywords win, `previousWeekPosition: null`, numeric `weekPosition`); the Cover third-attempt 4-point case is the `daily.constants.spec.ts` points test | PASS |
| Archive finish | `daily-ranking-summary.integration.spec.ts` :: Daily play ranking summary over HTTP (integration) does not count an archive finish and announces zero points | PASS |
| Reopening a finished puzzle | `daily-ranking-summary.integration.spec.ts` :: Daily play ranking summary over HTTP (integration) reports the same points when a finished puzzle is reopened, :: reports the bonus of a reopened same-week result from its own day (yesterday's fourth mode → `bonusEarned 2`), and :: reports a reopened last-week result without moving this week's position (`previousWeekPosition == weekPosition`) | PASS |
| Supporter with hidden badge | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) GET /daily/ranking limits the following scope to the viewer and followed players (supporter A badge true, supporter B hidden → false, positions unchanged) | PASS |

Notes for daily-ranking:

- **Freshness.** No ranking list is cached; `read` queries `daily_ranking_entry` directly, and the
  "shows another player's finish on the next read" test proves the next read includes a committed finish
  (stronger than the 60 s bound). Bans use `AuthService.getLockedUserIds`, cached 60 s:
  `lockout-limit.spec.ts` :: AuthService.getLockedUserIds caches the list for 60 seconds.
- **Position-change baseline.** `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly
  challenge over HTTP (integration) GET /daily/ranking reports positions moved since yesterday and new
  players also asserts `positionChange` is null before today's snapshot and for `period=today`.
- **Deleted accounts.** `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL deletes
  the entries of a deleted profile.
- **Decomposition.** `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL writes one
  absolute aggregate per partition, ignoring unranked and weekly rows (today/week/month/all, overall and
  modes, bonus days, a 0-point loss, unranked and weekly rows), :: rebuilds what the per-player recomputes
  wrote, and :: writes the same rows when the same player is recomputed again.
- **Concurrency.** `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL counts two
  concurrent finishes by one player in different modes and :: counts a puzzle finished twice at the same
  time once.

## daily-weekly-challenge

| Scenario | Evidence | Status |
| --- | --- | --- |
| Monday reset | `daily.scheduler.spec.ts` :: numbers puzzles per kind and dates weekly challenges on the Mondays (current and next week, both Mondays, weekly numbers 8 and 9 after 7) | PARTIAL |
| Specs rules | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) weekly challenge lists this week's challenge with the viewer's result once it is played (`maxAttempts 10`, won through the Specs play endpoint); `daily-evaluator.spec.ts` :: evaluateDaily specs columns is partial on overlap and none otherwise, with the guess's own values and :: evaluateDaily specs hint is available after 5 guesses and costs an attempt | PARTIAL |
| Signed-in player who finished it | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) weekly challenge lists this week's challenge with the viewer's result once it is played (`result: { status: won, attempts: … }`; 1 attempt in the test, stored attempts are reported) | PASS |
| Next week's challenge | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) weekly challenge rejects next week's challenge as not found (404) | PASS |
| Archive | `daily.controller.integration.spec.ts` :: DailyController on MySQL lists weekly challenges only in results asked by kind (weekly absent from today's list, archive and default results; present with `kind=weekly`) | PASS |
| Daily ranking | `daily.service.integration.spec.ts` :: DailyService counted results on MySQL counts a weekly finish inside its week without points; `daily-ranking.integration.spec.ts` :: DailyRankingService writes on MySQL never writes an entry for an archive or weekly finish | PASS |
| Friends ranking | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) weekly challenge ranks the viewer against followed players who finished, winners first (3, 4 and 5 attempts; viewer second) | PASS |
| Followed player not finished | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) weekly challenge ranks the viewer against followed players who finished, winners first (in-progress and imported rows absent) | PASS |
| Without session | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) weekly challenge ranks the viewer against followed players who finished, winners first (401 assertion) | PASS |
| Guest import | `daily-ranking-read.integration.spec.ts` :: Daily ranking and weekly challenge over HTTP (integration) weekly challenge ranks the viewer against followed players who finished, winners first (an imported `ranked = 0` row is seeded and absent); `importResults` has no kind filter and always writes `ranked = false` (code check). No test posts a weekly result through `POST /v1/daily/results/import`. | PARTIAL |

Partial notes for daily-weekly-challenge:

- **Monday reset.** No test moves the clock across Monday 00:00; the test asserts the boot/`ensurePuzzles`
  result (this and next Monday, per-kind numbering, only those dates). The same `mondayOf(dailyToday())`
  computation runs on the daily cron.
- **Specs rules.** Weekly rows are `kind=weekly, mode=specs` and go through `DailyService.play` /
  `evaluateDaily`, so the 10-attempt limit and won state are asserted on the weekly row; the feedback and
  hint columns are covered by the evaluator Specs tests, not by a weekly-specific assertion.
- **Guest import.** The friends-ranking test seeds the imported row directly; the endpoint path for a
  weekly import is code-read only.

## daily-practice

| Scenario | Evidence | Status |
| --- | --- | --- |
| Start Cover practice | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) starts Cover and Specs rounds without revealing the answer (round id, 6 attempts, first image token, no answer/puzzleId/date) | PASS |
| Unsupported mode | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) rejects modes without practice (artwork, keywords, daily → 400) | PASS |
| Too many rounds | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) rate limits starts past 30 in a minute (30 × 201, then 429) | PASS |
| Same feedback as the daily | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) starts Cover and Specs rounds without revealing the answer (Specs wrong guess has `columns.releaseYear`, same DTO); `daily-evaluator.spec.ts` :: evaluateDaily specs columns is partial on overlap and none otherwise, with the guess's own values and :: evaluateDaily specs columns matches equal sets, including two empty ones | PASS |
| Another account | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) rejects a round started by another account (403 for another signed-in player and for a guest) | PASS |
| Rewriting progress | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) only lets a round's progress grow (rewrite → 400, appends accepted) | PASS |
| Tomorrow's answer | `daily-pool.service.integration.spec.ts` :: DailyPoolService on MySQL excludes today's and future daily answers in every mode from practice (tomorrow's Artwork answer blocks a Cover practice pick) | PASS |
| Winning practice | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) creates no result and leaves the ranking untouched after a win (no `daily_result` row, empty `/v1/daily/results`, no `ranking` block; the ranking service is stubbed and never called, and no result row is the only source of an entry change) | PASS |
| Old round | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) deletes rounds older than 7 days and reads them as 404 (play and image token 404, cron deletes) | PASS |

Supporting checks: `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) plays a
guest round by its id, :: serves images for a round and still serves old puzzle tokens, and :: deletes the
rounds of a deleted profile; `daily-evaluator.spec.ts` :: assertProgressCanGrow rejects removing or rewriting guesses and ::
assertProgressCanGrow rejects moving, adding or dropping a saved hint;
`daily.scheduler.spec.ts` :: deletes practice rounds past their week and past ranking partitions.

## daily-answer-selection

| Scenario | Evidence | Status |
| --- | --- | --- |
| Very well known game | `daily-pool.service.integration.spec.ts` :: DailyPoolService on MySQL keeps the 500 most reviewed games out of the weekly challenge (10 draws, never a top-500 id) | PASS |
| Unreviewed game | `daily-pool.service.integration.spec.ts` :: DailyPoolService on MySQL applies critic floor for 0 regardless of popularity (daily `pick`; weekly calls the same private `draw` with the same `aggregatedRatingCount >= 1` clause) | PARTIAL |
| Recent daily Specs answer | `daily-pool.service.integration.spec.ts` :: DailyPoolService on MySQL excludes a recent daily Specs answer from the weekly challenge (100 days ago; eligible again at 400) | PASS |
| Queued weekly answer | `daily-pool.service.integration.spec.ts` :: DailyPoolService on MySQL excludes a queued weekly answer from daily Specs | PASS |
| Recently used daily answer | `daily-pool.service.integration.spec.ts` :: DailyPoolService on MySQL allows past daily answers in practice and keeps the mode filters (100 days ago excluded from daily, allowed in practice; other modes still null) | PASS |
| No candidate left | `daily-practice.integration.spec.ts` :: Daily practice over HTTP (integration) responds 503 without a candidate and creates no round | PASS |

Partial note: **Unreviewed game.** The `aggregatedRatingCount >= 1` floor is asserted through the daily
pool window; `pickWeekly` calls the same private `draw` with the same WHERE clause, but no weekly-specific
zero-review test exists. The requirement is satisfied by construction.

## References

- Task 3.6 performance evidence: `design.md` § Measurements — table design. Medians are below the targets
  (`recompute` for a 2,000-result player 15.6 ms / worst 18.0 ms against 50 ms; ranking reads 72.8–84.3 ms
  medians; play summary 36.7 / 37.7 ms; snapshot 9.59 / 10.86 s), and the one worst sample over target is
  recorded there (`all` offset 49,900: 104.5 ms). Not re-run here.
- Task 7.1 hand-off: `handoff-clients.md` with the regenerated `server_swagger.json` (byte-identical after
  the boot check, sha256 above). Not re-verified here.

## Gaps

1. **`daily-ranking` — Player who only lost.** PARTIAL. The table test proves a 0-point loss writes an
   entry with `played=1`, and the read query has no points filter, but no HTTP ranking read seeds a player
   whose only counted result is a loss.
2. **`daily-weekly-challenge` — Monday reset.** PARTIAL. The boot/ensure path is tested; no clock crossing
   of Monday 00:00 is simulated (the cron uses the same `mondayOf(dailyToday())`).
3. **`daily-weekly-challenge` — Specs rules.** PARTIAL. The weekly row asserts 10 attempts and a won state;
   the Specs feedback/hint are covered by the shared evaluator tests, not by a weekly-specific assertion.
4. **`daily-weekly-challenge` — Guest import.** PARTIAL. The friends ranking excludes a seeded
   `ranked = 0` imported row; posting a weekly result through `/v1/daily/results/import` is not tested.
5. **`daily-answer-selection` — Unreviewed game.** PARTIAL. The critic floor is asserted through the daily
   `pick`; `pickWeekly` shares the same private `draw`, so there is no weekly-specific test.

Pre-existing failures observed in the wider run (not caused by this change; the failing files are
unmodified in this checkout and reproduce on `HEAD` 04ae93d):

- `src/profile/profile-video/profile-video-media.spec.ts` — 3 conversions fail with
  `ProfileVideoError: conversion_failed` (ffmpeg thread spawn: `Resource temporarily unavailable`).
- `src/search/manticore-deployment.spec.ts` — `docker compose config` fails because `CMS_ADMIN_EMAIL`,
  `CMS_ADMIN_PASSWORD` and `CMS_SECRET` are not set in `.env`.
- `src/auth/auth.integration.spec.ts` — the full-suite run and a single-suite run both abort with
  `RangeError: Maximum call stack size exceeded` in Nest's `InstanceWrapper.getInstanceByContextId`;
  reproduced in a clean `HEAD` worktree. This is why the full `pnpm test` has no suite result.

The full migration chain ran cleanly on a fresh MySQL 8.4.13, so the earlier
`ER_FK_INCOMPATIBLE_COLUMNS` note (`achievement_progress` → `profile`, migration
`1793600000000-ReworkPlatformAchievements`) did not reproduce in this checkout; nothing was changed for it.

## Summary

- 64 scenarios across the four specs: 59 PASS, 5 PARTIAL, 0 GAP.
- Partial evidence (listed above): loss-only daily read, Monday clock crossing, weekly-specific Specs
  feedback, weekly import through the endpoint, weekly-specific critic floor.
- Scenario examples with different literal numbers than the tests (4/5 = 80 % win rate, +3 move, viewer
  142nd, weekly win in 4 attempts) are marked PASS where the same computation is asserted; the actual
  numbers are in each row.
