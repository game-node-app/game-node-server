# Design

## Context

See proposal.md (Why). Current state in `src/daily`:

- `daily_puzzle` holds one row per mode and São Paulo date (`UQ_daily_puzzle_mode_date`, `UQ_daily_puzzle_mode_number`), generated 7 days ahead by `DailyScheduler` from `DailyPoolService.pick`, whose repeat filter is `p.mode = ? AND p.date > date - 365` with no notion of puzzle kind.
- `daily_result` holds one row per user and puzzle with `guesses`, `hintAt`, `status`, `attempts` and `finishedAt` (UTC, the connection uses `timezone: "Z"`). `DailyService.play` upserts it; it returns early once a result is finished, so the transition to won/lost happens in exactly one request. `importResults` inserts finished guest plays with `finishedAt = now`.
- Evaluation is pure (`evaluateDaily`); `evaluateWith` takes a whole `DailyPuzzle` but only reads `gameId`, `mode` and `meta`. Images are served from signed tokens `{ p: puzzleId, k, l }`.
- `attempts` already counts the Specs hint (`guesses.length + 1` when `hintAt` is set), so the scoring formulas apply to `attempts` directly.
- Reusable pieces: `BillingService.findSupporterUserIds`, `SupporterPreferencesService` (badge visibility), the better-auth `user` table (`banned`, `banExpires`, read through `AuthService`'s adapter as `getLockoutStates` does), the `UserFollow` table, `listToPaginationData` and the cache-manager pattern used by `SupportersService.getWall`, and `@Throttle` + `ThrottlerGuard` as in `profile-video.controller.ts`.

Design frames (Figma `ikcThguwowTdynGz0L2YkS`, section `5050:13680`):

| Frame | Node | Data it reads |
| --- | --- | --- |
| Ranking · Desktop · Geral · Semana | `5050:14254` | `GET /daily/ranking?period=week` (podium = rows 1–3, table, "Seu resumo", viewer footer) |
| Ranking · Desktop · Cover · Semana | `5050:14638` | same with `mode=cover` (wins, average attempts, best streak) |
| Ranking · Desktop · Estado vazio (Hoje) | `5050:14803` | `period=today` with few rows |
| Ranking · Desktop · Deslogado | `5050:15324` | guest read, `viewer: null` |
| Ranking · Mobile · Geral · Semana | `5051:13889` | same as desktop |
| Ranking · Hub v2 com entrada de Ranking | `5051:13890` | ranking `limit=3` + `viewer`; `weekly` on `GET /daily`; practice cards |
| Ranking · Resultado v2 com entrada de Ranking | `5051:14093` | `ranking` block of the play response |
| Ranking · Componentes / Notas | `5051:14622` / `5051:14642` | rules and decisions (scoring marked PROPOSTA, adopted as is) |

## Goals / Non-Goals

**Goals:**

- `daily_result` stays the only source of truth for points: ranking entries are derived from it, recomputed per player with absolute values (never incremented), and can be rebuilt from it at any time.
- No request aggregates a period. A ranking read, a play summary and a counted finish run only indexed queries whose cost is bounded by the page size or by one player's own results, whatever the number of players.
- Weekly challenge reuses puzzle generation, play, evaluation, images and import unchanged.
- Practice reuses evaluation and images without touching `daily_result`.

**Non-Goals:**

- Bans and suspensions applied faster than 60 s (the locked id list is cached for 60 s; the spec allows that staleness).
- Entries for past periods: only the periods containing today are read, so older partitions are deleted.
- Ranking history beyond "yesterday" for position changes.

## Decisions

### 1. Puzzle kind on `daily_puzzle`

Add `kind varchar(16) NOT NULL DEFAULT 'daily'` (`daily` | `weekly`). Replace the two unique keys with `(kind, mode, date)` and `(kind, mode, number)` and add an index on `(kind, date)` for ranking range scans. A weekly challenge is a `kind = 'weekly'`, `mode = 'specs'` row dated on the Monday of its week.

Every daily read filters `kind = 'daily'`: `findToday`, `findArchive`, `findResults` (new optional `kind` query, default `daily`), `importResults` keeps accepting both (spec: weekly imports are saved). `play` accepts both kinds; `date > today` already hides next week's challenge.

Alternative: a separate `daily_weekly_puzzle` table. Rejected: play, evaluation, image tokens, import, community and results would all need a second path for a puzzle that differs only in its calendar.

### 2. `ranked` and `points` on `daily_result`

Add `ranked tinyint NOT NULL DEFAULT 0` and `points smallint unsigned NOT NULL DEFAULT 0` in tenths of a point (6 → 60, 0.6 → 6). Both are written once, in `play`, when the upsert moves a result to won/lost:

- `ranked = userId && finished through play && dailyToday() ∈ [puzzle.date, activeEnd]`, where `activeEnd` is `puzzle.date` for daily and `puzzle.date + 6` for weekly. `importResults` always writes `ranked = 0`.
- `points` only for `kind = 'daily'` and `ranked`: won → `mode = specs ? 6 * (11 - attempts) : 10 * (7 - attempts)`; lost → 0. One exported pure function `dailyPoints(mode, status, attempts)` with a unit test, reused by the migration's SQL check.
- The bonus is not stored on results; the entry recompute (decision 3) derives it per date from the player's ranked wins (four distinct modes won), so it cannot drift from the results.

Alternative: compute points at query time from `attempts`. Rejected: the `ranked` flag must be stored anyway (import vs. play is not derivable), and stored points keep the recompute a plain sum.

### 3. Ranking entries: a derived table recomputed per player

Two earlier rounds cached whole ranking lists (an immutable history merged with today's aggregate). Measured at 50k players (see Measurements), they missed the 500 ms trigger: each list is 8.7 MB in Redis, so a cache-hit read costs ~0.55 s and a refresh ~1.6 s; a cold cache aggregates the whole period (8–27 s for `all`); every finished play loaded the whole week list for its summary; and streaks read every win of every visible player. The materialized table that the old shortcut named as its upgrade replaces them before launch.

**Table `daily_ranking_entry`**, one row per period partition, filter and player:

- Key: `period varchar(8)` (`today` | `week` | `month` | `all`), `periodStart date` (today, Monday, the 1st, or `2000-01-01` for `all`), `mode varchar(16)` (`overall` or a `DailyMode`), `userId varchar(36)`. Primary key in that order; `userId` FK to `profile` `ON DELETE CASCADE`, so deleted accounts leave every ranking at once.
- Values (tenths, `int unsigned`): `points` (bonus included on `overall` rows), `coverPoints`, `artworkPoints`, `keywordsPoints`, `specsPoints` (`overall` rows only, 0 on mode rows), `wins`, `played`, `winAttempts`, and `lastFinishedAt datetime NOT NULL` (every counted result has a finish).
- Values without today's puzzles, for position changes: `prevPoints`, `prevPlayed`, `prevWinAttempts`, `prevLastFinishedAt datetime NULL`, and `asOf date`, the São Paulo day of the recompute that wrote them. A row whose `asOf` is before today has no counted result today, so its previous values are its current ones.
- Streaks, on `all` rows only: `streak` and `streakEnd date NULL` on the `overall` row (the latest run of days with a counted win and the day it ends), `bestStreak` on each mode row.
- Index `IDX_daily_ranking_entry_order (period, periodStart, mode, points DESC, winAttempts, lastFinishedAt, userId)`: the spec's ordering. Every ranking query walks or counts it; the SQL `ORDER BY` is the ordering, so `compareRankingEntries` and `mergeRankingEntries` go away.

**Write: `DailyRankingService.recompute(userId, today, manager)`.** When `play` moves a result to won/lost with `ranked` on a daily puzzle, the result upsert and the recompute run in one transaction:

1. `SELECT userId FROM profile WHERE userId = ? FOR UPDATE` serializes the player's finishes, so two concurrent finishes (different modes, or the same puzzle twice) never write entries from a stale read.
2. Read the player's ranked daily results (`mode`, `date`, `points`, `status`, `attempts`, `finishedAt`; at most four per day, through `UQ_daily_result_user_puzzle`).
3. In TS, group them into the four partitions containing today (today, its week, its month, `all`) for `overall` and each mode with a result in the partition: sums, the bonus per date with four distinct modes won, values without today, `asOf = today`, and the streaks through `computeStreaks` (the run ending at the latest win date, so a read can tell whether it is still alive).
4. One multi-row `INSERT … ON DUPLICATE KEY UPDATE` with absolute values (at most 20 rows).

Only finishes on the puzzle's own day are ranked, so only partitions containing today ever change, and nothing else writes ranked results: imports write `ranked = 0`, practice never writes results, weekly results earn no daily points and are skipped. Recomputing from the player's full history instead of incrementing makes a retry, a duplicate request or a rebuild produce the same row.

`rebuild(today)` runs the same computation for every player with ranked results, in batches of 500 players (one read and one upsert per batch). The scheduler runs it on boot when no `all` entry exists while ranked results do, under `GET_LOCK('daily_ranking_rebuild', 0)` so only one replica runs it. It also serves as the repair path: truncate the table and restart.

**Read: `GET /daily/ranking`.** All reads target the partition `(period, periodStart(period, today), mode ?? 'overall')` and exclude locked players with `userId NOT IN (:locked)`. `locked` is the list of currently banned or suspended ids (`AuthService.getLockedUserIds()`, through the same adapter, filtering `banExpires` like `getLockoutStates`), cached for 60 s. It is small, so banned players never take a position.

- Page: `ORDER BY points DESC, winAttempts, lastFinishedAt, userId LIMIT offset, limit` along the index.
- `totalPlayers`: `COUNT(*)` over the partition.
- Viewer: their row by primary key, then position = 1 + `COUNT(*)` of rows ordered before it (`points > ? OR (points = ? AND (winAttempts < ? OR …))`, an index range within the partition).
- `pointsToTop100`: the points of the row at `LIMIT 99, 1`.
- `scope=following`: the partition rows where `userId IN (viewer + followed)`, ordered by the same `ORDER BY` and numbered in TS. This is bounded by the number of follows, and the totals, viewer and gap come from that set.
- Hydration of the visible rows plus the viewer: profiles, badges, and the player's `all` rows by primary key for streaks. The current streak is `streak` when `streakEnd >= today - 1`, else 0.

No list is cached. A read reflects every committed finish, and bans apply within 60 s.

**Position change: `daily_ranking_snapshot`.** A narrow table `(period, periodStart, mode, date, userId, position)` with primary key in that order holds the previous list for `week`, `month` and `all`. It has no FK: a cleanup cron removes its rows, and a deleted account only leaves a gap.

- `snapshot(today)` reads each partition ordered by the values without today: the `prev*` columns when `asOf = today`, else the current ones, for rows that had played before today.
- It numbers those rows in TS and inserts them in chunks of 1,000. Because it writes a different table, it never holds locks that a finish waits on.
- It ignores lockouts and always gives the same result for the same day, so it can run at any time and runs again without harm.
- When every partition is written, it sets the cache marker `daily:ranking:snapshot:{today}`.
- On the first day of a week or month the partition has no previous rows, so everyone is new.
- The scheduler runs it at 00:00 São Paulo and on boot when the marker is missing (same `GET_LOCK` pattern).

A read takes the snapshot positions of the visible ids and of the locked ids. The previous position is the snapshot position minus the number of locked players whose snapshot position is lower, so a ban or unban never shifts the others. For `scope=following`, the set members with a snapshot position are renumbered in that order, without locked players. A row without a snapshot position is `"new"`. When the marker is missing, every `positionChange` is null.

`shortcut: a profile deleted today leaves a gap in today's snapshot, so the rows below it report one position more than they moved until the next snapshot; upgrade by re-running the snapshot on account deletion if that ever matters.`

**Cleanup.** The 00:35 cron that removes practice rounds also deletes entries of past partitions (`today` before today, `week` before this Monday, `month` before this month's 1st) and snapshot rows dated before today.

Alternatives considered:

- Increment the entries on each finish: needs exactly-once transitions in `play`, and a drift is permanent.
- Redis sorted sets: four tie-break keys do not fit a `double` score, lockouts still need filtering, and the backfill would live in a second store.
- Keep the cached lists in process memory: fixes only the Redis payload, not the cold aggregate, the per-finish week list or the streak reads, and costs hundreds of MB per replica.

### 4. Streaks stored on `all` entries

`computeStreaks(dates, today)` stays the pure source of the rules and runs inside `recompute` over the player's ranked wins (decision 3, step 3). The read only compares `streakEnd` with yesterday. There is no per-read scan of win history and no separate streak table. The rebuild fills the streaks for existing results.

### 5. Play response `ranking` block

After a finishing `play` (or a reopen of a finished daily puzzle) by a signed-in user, `DailyRankingService.summaryAfterPlay(userId, result, date)` gets the puzzle date from `DailyService.rankingSummary`. A finish runs it after the recompute's transaction commits, so the player's entries already include the result.

- `pointsEarned = points / 10`. `bonusEarned` is 2 when this result is the fourth distinct mode won-ranked on its puzzle date (one small query). A result reopened on a later day still reports the bonus of its own day.
- `weekPoints` comes from the player's `(week, this Monday, overall)` entry, read by primary key.
- `weekPosition` = 1 + the count of non-locked rows ordered before that entry, excluding the player, in the same partition. `previousWeekPosition` is the same count for the entry minus this result's points and bonus. The subtraction only happens when the puzzle date is in the current week: a result from a past week is not part of the week entry, so the previous position equals the current one. `previousWeekPosition` is null when the viewer had no other counted result this week (`played = 1`).
- `pointsToTop100` uses the same `LIMIT 99, 1` read as the ranking.

The block is absent for guests, unfinished plays and weekly puzzles.

### 6. Weekly challenge

- `DailyScheduler` also ensures weekly rows for the current and next Monday (`kind = 'weekly'`, `mode = 'specs'`, number = `MAX(number) WHERE kind = 'weekly'` + 1).
- `DailyPoolService.pick(mode, date, pool)` gains a pool window: daily uses `{ offset: 0, size: 1000 }`, weekly `{ offset: 500, size: 2000 }`. The repeat filter already ignores kind, which is exactly the shared Specs history the spec requires.
- `findToday` adds `weekly: { id, number, mode, maxAttempts, endsAt, result? } | null`.
- `GET /daily/weekly/ranking` (session): current weekly puzzle, ranked finished results where `userId IN (viewer + followed)`, ordered won first, attempts asc, `finishedAt` asc; hydrate profiles and badge as in decision 3. Not cached: bounded by follows who finished.

### 7. Practice rounds

New entity `DailyPracticeRound` (`daily_practice_round`): `id char(36)` (UUID v4, the round id is the capability for guest rounds), `userId varchar(36) NULL` FK profile `ON DELETE CASCADE`, `mode`, `gameId` FK game, `meta json`, `guesses json`, `hintAt`, `status`, `attempts`, `createdAt` (indexed), `finishedAt`.

- `POST /daily/practice` `{ mode: cover | specs }`, `@Public`, `@Throttle({ default: { limit: 30, ttl: seconds(60) } })` with `ThrottlerGuard`. Picks via `DailyPoolService.pickPractice(mode)`: same mode filters and 1,000 pool, no 365-day filter, `g.id NOT IN (SELECT gameId FROM daily_puzzle WHERE date >= mondayOfThisWeek)` for weekly and `date >= today` for daily, all modes. No candidate → 503. Returns the evaluated empty play.
- `POST /daily/practice/:id/play` reuses the grow-only checks from `play` (extract the shared check into a small function instead of copying it) and `evaluateWith`, whose parameter becomes `Pick<DailyPuzzle, "gameId" | "mode" | "meta">`.
- Images: token payload gains `s?: "r"`; with it `p` is the round id and `getImage` reads the round. Cache key includes the source. Existing tokens (no `s`) keep working.
- Response DTO `DailyPracticePlayResponseDto`: the play fields with `roundId` instead of `puzzleId`/`number`/`date`, without `community` and `ranking`.
- Cleanup: a daily cron in `DailyScheduler` deletes rounds with `createdAt < now - 7 days`; reads also treat older rows as 404 so a missed cleanup cannot leak.

Alternative: store practice as `daily_puzzle` rows of a third kind. Rejected: they have no date or number, would need nullable unique columns, and would leak into every daily query that forgets to filter.

### 8. Migration and backfill

One raw-query migration (house style, see `1795000000000-AddSupporterPreferences.ts`): columns, unique key swap, index, practice table, ranking tables, then

```sql
UPDATE daily_result r JOIN daily_puzzle p ON p.id = r.puzzleId
SET r.ranked = 1,
    r.points = IF(r.status = 'won', IF(p.mode = 'specs', 6 * (11 - r.attempts), 10 * (7 - r.attempts)), 0)
WHERE r.status <> 'in_progress' AND r.finishedAt IS NOT NULL
  AND DATE(CONVERT_TZ(r.finishedAt, '+00:00', '-03:00')) = p.date;
```

Numeric offsets in `CONVERT_TZ` need no time zone tables; `-03:00` matches the existing `dailyNextResetAt` shortcut.

The same migration creates `daily_ranking_entry` and `daily_ranking_snapshot` (decision 3) empty. Entries are filled by `rebuild` on first boot rather than in SQL, because the bonus and streak rules live in TS (`computeStreaks`, the bonus grouping), and one implementation keeps the backfill and the per-finish recompute identical.

`down` drops the ranking tables, the practice table, the columns and the index and restores the old unique keys (it fails if weekly rows exist; delete them first, stated in the migration comment).

### 9. Hand-off

The final task writes `handoff-clients.md` in this change, in the format of `add-supporter-profile-perks/handoff-clients.md` and `add-2026-recap-and-awards-events/handoff-clients.md`: conventions (points are decimals with one place; São Paulo day boundaries; finishes visible on the next read, bans within 60 s), each endpoint with query, response and statuses, the frame-to-endpoint map above, and client responsibilities (podium from rows 1–3, "Vaga aberta" placeholders, "Premium" badge from `supporterBadge`, guest CTA, practice and weekly entry points). Client implementation is a separate change in `game-node-clients`.

## Risks / Trade-offs

- [Entries are a second copy of the points] → They are never incremented: every write recomputes the player's rows from `daily_result`, so a retry or duplicate request writes the same values, and `rebuild` restores the table from results. An integration test checks entries against one full aggregate per partition.
- [Every counted finish adds a transaction (profile row lock, the player's history read, up to 20 upserted rows)] → It is bounded by the player's own results (≤ 4 per day) and serializes only that player's finishes. Measured in task 3.6, with an upgrade trigger in the shortcut below.
- [Midnight is both the play peak and the snapshot run] → The snapshot reads without locks and writes a different table in 1,000-row chunks, so finishes never wait on it. Until it ends, `positionChange` is null rather than wrong.
- [Deploying with existing results] → The ranking fills while `rebuild` runs on first boot (batches of 500 players); measured in task 3.6. Pre-launch, so a partial ranking for that window is accepted.
- [Historical imports finished on the puzzle day are backfilled as counted] → The data cannot tell them apart; accepted for launch, stated in the hand-off. New imports never count.
- [Guest practice rounds are playable by anyone with the id] → The id is a random UUID and the round has no value outside practice.
- [Practice can reveal games that become future daily answers] → Only reservations that exist are excluded; a later daily may reuse a practiced game. Accepted: practice answers are not secret once played.
- [Removing the old unique keys] → Replaced in the same migration by keys that are strictly narrower per kind; existing rows are all `daily`, so no conflict.

`shortcut: recompute reads the player's whole ranked history on every counted finish; upgrade to extending the stored all-time row with today's results when a player's ranked results exceed ~10k or recompute p95 exceeds 50 ms.`

### Measurements (task 3.6)

**Earlier rounds (cached lists, superseded by decision 3).** Scratch schema on the test MySQL 8.4.13 with 50,000 ranked players and 1.96M results over 500 days:

- `all` with a cold cache: 8–27 s.
- A refresh with history cached: 0.42 s in-process, ~1.63 s through the deployed Keyv/Redis store, because each list is 8.7 MB and costs 125–230 ms per `get`/`set`.
- A cache-hit read through Redis: ~0.55 s.
- `week`: 0.14–0.33 s in-process and 0.55–0.65 s through Redis.
- Not measured, but read in the code: each finished play loaded the whole week list for its summary, and streak hydration read every win of the visible players (~100k rows per page once top players have 500 days of history).

These numbers led to the table.

**Table design (to fill in task 3.6).** Use the same seed, plus 100 players with 2,000 ranked results each placed in the top 100. Run against the real Redis cache store, five samples per step, and record medians and the worst sample.

| Step | Target | Result |
| --- | --- | --- |
| `rebuild` of all players | recorded, no target (boot-time, once) | 52.4 s on the empty table, then 33.6–33.9 s: median 33.8 s, worst 52.4 s |
| `recompute` for a 2,000-result player | < 50 ms | 15.6 ms median, 18.0 ms worst — met |
| `GET /daily/ranking` `week` and `all`: first page, offset 49,900, `scope=following` (500 follows), viewer near position 40,000 | < 100 ms each | first page: `week` 72.8/76.9 ms, `all` 84.3/88.0 ms; offset 49,900: `week` 73.6/81.7 ms, `all` 81.2/104.5 ms (repeat series 79.4/84.0 and 71.2/75.0); following 500: `week` 42.1/48.7 ms, `all` 41.8/46.1 ms |
| Play summary after a counted finish | < 100 ms | 36.7 ms median, 37.7 ms worst — met |
| `snapshot` of all 15 partitions | < 60 s, no finish waiting > 100 ms on a lock meanwhile | 9.59 s median, 10.86 s worst (601,500 rows, marker set); 20 finishes during a snapshot 203.7/247.8 ms against 313.2/371.2 ms for the same 20-way batch without one, so no snapshot-attributable wait |

Median/worst of five samples per step (reads: one unmeasured warm-up request per variant first). Test docker-compose MySQL 8.4.13 (127.0.0.1:13306, 128 MB buffer pool) and Redis 8.10.3 (127.0.0.1:16379) through a Keyv/Redis cache manager, on a scratch database built by running `1795400000000-AddDailyRankingAndChallenges` after its predecessors (not `synchronize`). Seed: 50,000 regular players with 1,760,000 ranked results over 500 days (at most four a day) and 100 players with 2,000 results each (all 100 in the top 100), 2,000 daily puzzles, 1,960,000 ranked results; real `DailyRankingService`/`DailyService` and `GET /v1/daily/ranking` (Nest/supertest), real cache manager. The first rebuild ran on 2026-11-16 against an empty entry table (its four reruns were 33.6–33.9 s); reads, summary and the 15-partition snapshot used 2026-11-18 (a Wednesday, harness clock shifted) so week/month/all had previous values. `AuthService` was the integration-spec stub (no banned users), with the real `getLockedUserIds` cache path over Redis.

Fixed in review: the partition page query now skips the offset on `IDX_daily_ranking_entry_order` and then reads the 100 selected rows by primary key (deferred join, same `WHERE`/`ORDER BY`), so offset 49,900 fell from 276.0/264.9 ms to 73.6/81.2 ms median (81.7/104.5 ms worst); `EXPLAIN ANALYZE` shows a covering index lookup over the 50,000 entries (13.4/12.6 ms) plus 100 single-row primary-key lookups. The rows and their order are identical to the old query at offsets 0 and 49,900.

## Migration Plan

1. Deploy the migration and code together; the `ranked`/`points` backfill runs in the migration.
2. On boot the scheduler creates this and next week's challenge, runs `rebuild` (entries are empty) and then `snapshot` (no marker for today).
3. Rollback: revert the code and run the migration `down` after deleting weekly puzzles and their results.

## Open Questions

- Weekly pool window (positions 501–2,500) and practice rate limit (30/min) are constants; tune after a week of data without spec changes.
