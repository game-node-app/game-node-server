# Tasks

## 1. Data model and scoring

- [x] 1.1 Add `kind` to `DailyPuzzle` (unique keys `(kind, mode, date)` and `(kind, mode, number)`, index `(kind, date)`) and `ranked`/`points` to `DailyResult` (design 1, 2); verify `pnpm test:typecheck` passes.
- [x] 1.2 Add the exported pure `dailyPoints(mode, status, attempts)` in tenths (design 2); verify a unit test covers Cover 1st/3rd/6th attempt, a skip, Specs 1st/10th, Specs hint after five guesses (2.4) and a loss.
- [x] 1.3 Write the raw-query migration with the column/key changes, the `daily_practice_round` table and the backfill `UPDATE` (design 7, 8); verify on a clean MySQL that `up` and `down` run, and that seeded results finished on the puzzle day (São Paulo, including 23:59 local = 02:59 UTC next day), after it, and in progress get `ranked`/`points` exactly as `dailyPoints` gives, with puzzles, guesses, statuses and attempts unchanged.
- [x] 1.4 Add the `daily_ranking_entry` and `daily_ranking_snapshot` tables to the same migration with their entities (design 3, 8): keys, order index, `userId` FK cascade on entries only; verify on a clean MySQL that `up` and `down` run and that `EXPLAIN` of the page query (`ORDER BY points DESC, winAttempts, lastFinishedAt, userId LIMIT`) uses `IDX_daily_ranking_entry_order` without a filesort.

## 2. Counted results in play and import

- [x] 2.1 In `DailyService.play`, write `ranked` and `points` on the transition to won/lost following design 2, and always write `ranked = 0` in `importResults`; verify integration tests for same-day finish, finish after midnight, archive finish, guest play (nothing saved), imported same-day result, weekly finish within and after its week (ranked, 0 points), and a reopen not changing stored values.
- [x] 2.2 Filter `findToday`, `findArchive` and `findResults` (new optional `kind` query, default `daily`) to daily puzzles; verify the existing `daily.controller.integration.spec.ts` passes and new cases show a weekly puzzle absent from today's list, archive and default results, and present with `kind=weekly`.

## 3. Ranking

- [x] 3.1 Add pure `computeStreaks(winDates, today)` and the ranking comparator (design 3, 4); verify unit tests for streak ending today, ending yesterday, broken two days ago, best streak per mode, and ties broken by attempts, last finish and user id. (The comparator is removed in 3.2; its tie cases move to SQL in 3.4.)
- [x] 3.2 Replace the cached-list `DailyRankingService.list` with `recompute(userId, today, manager)` and `rebuild(today)` (design 3, 4). `play` runs the finishing upsert and the recompute in one transaction behind the profile row lock; the scheduler runs `rebuild` on boot under `GET_LOCK` when no `all` entry exists. Remove `history`, `day`, `aggregate`, `mergeRankingEntries`, `compareRankingEntries`, the list cache keys and the in-flight map, and move their tests' cases to the table. Verify integration tests that entries equal one full aggregate per partition (reuse the decomposition fixture: today/week/month/all, overall and mode, bonus days, a 0-point loss, unranked, imported and weekly rows ignored), the bonus appears only with four modes won and never on mode rows, two concurrent finishes by one player both end up counted, a repeated recompute changes nothing, `rebuild` equals per-player recomputes, deleting a profile removes its entries, and streak columns match `computeStreaks`.
- [x] 3.3 Add `snapshot(today)`, its 00:00 cron and boot run, the cache marker, and the cleanup of past partitions and snapshots in the 00:35 cron (design 3). Verify tests that previous positions equal the ranking without today's puzzles when the snapshot runs after some of today's finishes, a Monday and a 1st give an empty snapshot, a rerun writes the same rows, and the cleanup keeps only current partitions and today's snapshot.
- [x] 3.4 Rewrite the `GET /v1/daily/ranking` read on the table (design 3): partition page along the order index, `totalPlayers`, viewer position by count, `pointsToTop100`, following scope, locked ids from `AuthService.getLockedUserIds()` cached 60 s, previous positions from the snapshot adjusted for locked players, and hydration with streaks from `all` entries. Verify that the existing read and controller integration tests pass with unchanged expectations except the cache-specific ones, plus new cases: ties broken by attempts, last finish and user id in SQL; another player's finish visible on the next read; a ban leaving the list within 60 s without shifting the others' previous positions; `positionChange` null before today's snapshot.
- [x] 3.5 Rewrite `summaryAfterPlay` on the table (design 5); verify the existing summary integration tests (counted finish with bonus on the fourth mode and position before/after, archive finish, reopen including the same-week bonus and a past-week result, absence for guests, unfinished plays and weekly puzzles) pass unchanged.
- [x] 3.6 Measure the table design on the seed in design.md's Measurements (50k players, 1.96M results, 100 players with 2,000 results in the top 100) against the real Redis cache store and fill its table; verify every step is below its target, or record the gap and stop before 6.x.

## 4. Weekly challenge

- [x] 4.1 Give `DailyPoolService.pick` a pool window (daily 0/1000, weekly 500/2000) and have `DailyScheduler` ensure this and next week's weekly puzzle with its own numbering (design 6); verify tests that a top-500 game is never picked for weekly, a recent daily Specs answer is excluded from weekly and a queued weekly answer from daily Specs, numbering is per kind, and a duplicate insert by another replica is ignored.
- [x] 4.2 Add `weekly` to `GET /v1/daily` and `GET /v1/daily/weekly/ranking` (design 6), with a follow-id lookup on `UserFollow`; verify integration tests for the weekly entry with and without a result, null when missing, next week's puzzle 404 on play, friends ranking ordering (winners by attempts then finish, then losers), unfinished and imported results absent, and 401 for guests.

## 5. Practice

- [x] 5.1 Add the `DailyPracticeRound` entity, `DailyPoolService.pickPractice` and widen `evaluateWith` to `Pick<DailyPuzzle, "gameId" | "mode" | "meta">`, extracting the grow-only progress check shared with `play` (design 7); verify unit tests that the shared check still rejects the same cases and that `pickPractice` excludes today's and future daily answers in all modes and the current weekly answer, while allowing past daily answers.
- [x] 5.2 Add `POST /v1/daily/practice` and `POST /v1/daily/practice/:id/play` with throttling, ownership and the practice response DTO, and the `s: "r"` image token variant (design 7); verify integration tests for Cover and Specs start, 400 for other modes, 429 past the limit, 403 for another account, guest round playable by id, grow-only 400, images served for a round, old tokens still served, 503 with no candidate, and no `daily_result` row or ranking change after a practice win.
- [x] 5.3 Add the daily cleanup cron and the 7-day read cutoff; verify tests that a round older than 7 days is deleted and responds 404, and that deleting a profile deletes its rounds.

## 6. Integration

- [x] 6.1 Regenerate `verification.md` after the ranking rewrite (the cache-based evidence rows no longer exist): run `openspec validate add-daily-ranking-and-challenges --strict` and map each scenario in the four specs to a passing test or a recorded manual check, listing any gap in this change.
- [x] 6.2 Run `pnpm build`, `pnpm test:typecheck`, the unit suite and the daily integration suites, and verify they pass and the application boots with no new provider cycle.

## 7. Client hand-off

- [x] 7.1 Regenerate `server_swagger.json` and update `handoff-clients.md` (freshness is now the next read for finishes and 60 s for bans; drop the deleted-account cache-window note and the 60 s list-cache wording) in this change following design 9 and the existing hand-offs, stating that client implementation is a separate change in `game-node-clients`; verify every endpoint, query parameter, field, default and status in it matches the implemented DTOs and the Swagger file, and that each Figma frame in the design's frame table is mapped to its data.

## Workflow follow-up

- Archive the change after the hand-off is delivered and the implementation is reviewed.
