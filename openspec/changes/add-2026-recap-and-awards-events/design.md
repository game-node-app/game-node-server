# Design

## Context

See proposal.md for the reasons behind this change. These are the parts of the current code that shape the approach:

- **Awards** (`src/awards`). `AwardsEvent` stores only `votingStartDate`, `votingEndDate` and `resultsDate`. Admins curate nominees in `AwardsCategorySuggestion`, and the public categories read returns them as `suggestions`. `registerVote` checks that the game was released in the event year and does not check nominees.
  - `AwardsResultQueue` runs every 6 h. `AwardsResultProcessor` computes results only when `resultsDate` is today and inserts a new `AwardsCategoryResult` on every run, so up to 4 duplicates per category can be stored on results day.
  - `getRunningEvent` filters by `dayjs().year()`, so it cannot find the 2026 event in January 2027.
- **Recap** (`src/recap`). `getTargetRecapYear` returns the current year only in December. The 04:00 daily job enqueues only users who have no Recap.
  - `createRecap` calls `upsert(entity, ["id"])` without an id. The `(profileUserId, year)` unique index therefore makes a second generation fail.
  - `getTotalPlaytimeForPeriod` groups by `(gameId, source, platformId)`, so a game can appear more than once in `playedGames`.
- **Playtime history**. It stores cumulative observations per `(user, game, source, platform)` with `createdAt`. Period estimates sum non-negative increments and attribute each one to its ending observation (`playtime-history` spec). Day-level estimates can reuse that rule.
- **Reviews**. `rating` is a float from 0 to 5. The client converts it to the 0–10 scale shown in the design.
- **Library**. `CollectionEntryStatus` has the values playing, finished, planned, dropped and ongoing. There is no wishlist, so the design's "Na sua lista de desejos" maps to `planned`.
- **Notifications**. There is a transactional outbox (`appendNotificationIntent`) with a typed `NotificationEventType` union. `NotificationsProjectorService` resolves the destination for each type. Every intent has a single recipient, and there is no broadcast.
- **Achievements**. Metrics come from a closed catalog in `achievement-metrics.ts`. `AchievementsQueueService.addTrackingJob({userId, metric})` triggers evaluation. XP and medals belong to the admin-defined achievement, not to code.
- **Database**. MySQL with hand-written timestamped migrations in `src/migrations`.

## Goals / Non-Goals

**Goals:**
- Every value shown in the design's Recap, Awards ballot, results, Home cards and stories can be read from at most two calls per screen.
- Event phases and milestones come from stored dates, with no code change needed for the 2027 edition.
- Daily Recap regeneration costs scale with active users, not total users.

**Non-Goals:**
- Server-side image rendering for share cards or stories.
- Per-user timezones. All day boundaries use UTC.
- Tracking a separate wishlist.
- Returning full game objects. Responses carry game ids, and clients keep using the existing game repository reads for covers, names, developers and platforms.

## Decisions

### 1. Phase is computed, not stored
`phase` is a pure function `getAwardsPhase(event, now)` that runs at read time and is reused by the lifecycle tick. Storing a phase column would need a job to keep it correct and could drift from the dates.

`GET /v1/awards/events/current` returns the event with the highest `year` whose `COALESCE(nominationStartDate, votingStartDate) <= now`. Declare it before `events/:id` in `AwardsController` so Nest does not match `current` as an id. Existing event reads return the same DTO with the added `phase` and dates. The response only gains fields.

### 2. Nominees reuse `AwardsCategorySuggestion`
The finalized nominees go into the existing suggestion table. The categories read already returns that table, the admin add and remove endpoints already exist, and clients already render it. A new `awards_category_nominee` table would duplicate all three.

`awards_category` gains:
- `nomineeCount` (smallint, default 6);
- `nomineesFinalizedAt` (nullable datetime), which marks a category as finalized so a later tick never rewrites admin edits.

Finalization inserts the top N games by `COUNT(DISTINCT profileUserId)` from `awards_nomination`, ordered by `count DESC, gameId ASC`. It skips categories that already have suggestions and stamps `nomineesFinalizedAt` in every case. Each category runs in its own transaction.

### 3. Nominations table
The new table is `awards_nomination (id, categoryId, gameId, profileUserId, createdAt)` with a unique index on `(categoryId, profileUserId, gameId)` and an FK cascade on profile and category. The PUT runs in one transaction that deletes the user's rows for the category and inserts the new set. That keeps the "replace" semantics simple and makes the 3-game limit trivial to enforce.

`AddCategorySuggestionDto`-style validation applies, with `gameIds: number[]` limited by `@ArrayMaxSize(3)` and `@ArrayUnique()`. Eligibility goes through a shared `assertGameEligible(event, game)`, which `registerVote` also uses. That function checks the year and the optional `eligibilityCutoffDate`.

### 4. One lifecycle tick replaces the result-only scheduler
`AwardsResultQueue` becomes an hourly scheduler. It reuses the same queue and the same scheduler id, so the upsert replaces the old pattern. The processor runs these steps for each event whose window covers `now` (from `nominationStartDate` or `votingStartDate` through `resultsDate + 40 days`):
1. If the nominations phase has ended, finalize nominees (decision 2).
2. If `now >= resultsDate` and no result exists for any of the event's categories, compute results (decision 5).
3. Fan out any milestone that is due and not stale (decision 8).

Hourly is enough for a milestone such as "voting opens", and each step is a cheap check when there is nothing to do. The 40-day window covers the January results period without scanning old events.

### 5. Idempotent results with a played-only count
The whole event's results are computed in one transaction, guarded by the new `UNIQUE(categoryId)` on `awards_category_result`. A concurrent second run fails on the unique index, and the tick logs that failure and ignores it.

The migration first deletes duplicate results and their winners, keeping the lowest id per category. It then adds the index.

Per category:
- One SQL query computes `votes`, and also `playedVotes` through a `LEFT JOIN` that checks whether the voter played the game. The played check uses the same definition as the ballot: `user_playtime.totalPlaytimeSeconds > 0` or a `collection_entry` with status in (playing, finished, dropped) or a non-null `startedAt` or `finishedAt`.
- Ranking uses `ROW_NUMBER() OVER (ORDER BY votes DESC, playedVotes DESC, gameId ASC)`.
- `awards_category_result_winner` gains `playedVotes` and `playedVotesPercentage`. `awards_category_result` gains `totalPlayedVotesCount`.
- The existing `LIMIT 10` stays. Nominee categories have at most `nomineeCount` games, and personal GOTY needs only the top entries.

Results are a snapshot. A voter who starts a game after results are computed does not change them. This is why `playedVotes` is stored instead of computed at read time.

### 6. The ballot is a single read
`GET /v1/awards/:eventId/ballot` uses these queries:
- categories with their suggestions;
- the user's votes for the event;
- `user_playtime` summed per game for the user, limited to all nominee ids;
- the user's `collection_entry` statuses and dates for those ids;
- the user's reviews for those ids;
- for the personal-GOTY suggestion, the user's played games in the event year from the period playtime and library dates, filtered by eligibility and ordered by rating, then playtime in the year.

The play context goes through one helper, `getUserPlayContext(userId, gameIds)`, which returns `Map<gameId, {status, playtimeSeconds, rating}>`. The scoreboard and the Recap community highlight reuse it.

It is not cached. Votes change the result, and every query is per-user and indexed.

### 7. Scoreboard is computed on read
`GET /v1/awards/:eventId/scoreboard/:userId` joins the user's votes with the position-1 winners and counts the voters in the personal-GOTY category who chose the same game, excluding the user. It runs two small queries over indexed columns, so a precomputed table is not worth the extra code.

### 8. Milestone fan-out through a campaign table
The new table is `notification_campaign (key PK, eventType, payload json, cursorUserId, completedAt, createdAt)`. It is generic notification infrastructure for "send this to many users once", not an event entity. Its two users, the Awards tick and the goal reminder, each create their own campaigns. Keys look like `awards:2026:voting_open`.

A milestone is due when `now >= its trigger time` and it is not stale. Stale means the phase it announces has ended. For reminders, stale means the deadline has passed.

The trigger times are:
- nominations open at `nominationStartDate`;
- nominations close tomorrow at `nominationEndDate - 24h`;
- voting open at `votingStartDate`;
- voting closes in 2 days at `votingEndDate - 48h`;
- results published once results exist.

The tick inserts the campaign row if it is missing (`INSERT IGNORE`), then processes batches of 1000 recipients. A batch selects `profile.userId > cursorUserId ORDER BY userId`, joins the auth `user` table to exclude banned users, and applies the milestone's extra filter: no nomination, or an incomplete ballot. For each batch, one transaction appends the intents and advances the cursor. That makes the fan-out resumable and keeps it to one notification per recipient. `completedAt` is set when a batch comes back empty.

The tick processes at most 20 batches (20k users), then yields to the next tick. Alternatives were rejected:
- A broadcast notification type would need inbox and read-state changes across the whole notification system.
- Enqueuing a BullMQ job per user loses the cursor and floods Redis.

New event types:
- `awards.milestone` with payload `{eventId, year, milestone}`;
- `recap.milestone` with payload `{year, milestone: "available" | "closed"}`;
- `goal.reminder` with payload `{year, target, finished}`.

All use `eventVersion` 1. The projector resolves each type to its own target:
- `{type: "awards", eventId, year, phase}`;
- `{type: "recap", userId, year}`;
- `{type: "goal", year}`.

The preview text comes from the milestone. The response DTO gains `NotificationAwardsTargetDto`, `NotificationRecapTargetDto` and `NotificationGoalTargetDto`, following the existing one-DTO-per-target pattern.

There is deliberately no shared "event" target. The Awards and the Recap are separate events, and a shared type would make clients branch on a sub-kind anyway.

Recap milestones are appended in the same transaction as the Recap write (decision 10), not through campaigns, because each one belongs to a single user's generation.

The goal reminder uses a campaign with key `goal:2027:july`. Its recipients are users with a `year_goal` row for that year.

### 9. Day-level playtime
`PlaytimeHistoryService.getDailyPlaytimeForPeriod(userId, start, end)` reuses the baseline subquery from `getTotalPlaytimeForPeriod` and groups by `DATE(ph.createdAt), gameId, platformId`. It returns rows `{day, gameId, platformId, seconds}`. The Recap needs these rows for three things:
- the daily array, by summing the rows per day;
- each game's first-played day, which is the earliest day with seconds above 0;
- the totals that already exist.

The daily array is stored as `year_recap.dailyPlaytimeSeconds` (MySQL `json`, an array of integers with one entry per day). Monthly totals, the top month, the longest streak, the top weekday and the weekend share are derived on read by a pure function `deriveCalendarHighlights(daily, year)` in `recap.utils.ts`. Storing them as columns would duplicate data and need a migration whenever a highlight changes.

### 9b. Recap opening time comes from a table
The new table is `year_recap_edition (year PK, opensAt datetime, updatedAt)`. `getRecapWindow(year)` returns the stored `opensAt`, or 15 Nov 00:00 UTC of that year when no row exists. `getCurrentRecap(now)` returns `{year: Y, phase: "live"}` when `now >= opensAt(Y)`. Otherwise it returns `{year: Y−1, phase: "closed"}`. Here Y is the current UTC year.

It replaces `getTargetRecapYear`, which `RecapCreateService.getTargetPeriod` and `RecapQueueProcessor` both call. Both become async and receive the resolved year.

Reads use a TypeORM query cache of 60 s with the id `recap_edition_<year>`. The admin PUT clears that cache id, so an edit applies at once on the replica that served it and within 60 s on the others.

The admin endpoint is `PUT /v1/recap/admin/editions/:year` with body `{opensAt}`. It sits in a small `RecapAdminController` guarded by `@Roles([EUserRoles.ADMIN])`, following `AwardsAdminController`, and validates that `opensAt` falls within `year`.

An env var was rejected because the user asked for a change without a deploy. A full settings or feature-flag system was rejected because no other caller needs it.

### 10. Regeneration is delete and insert in one transaction
`createRecap(userId, year, {final})` runs under `@Transactional()`. It finds the existing row, deletes it (child rows cascade), inserts the new Recap with its relations, and sets `isFinal`. On failure the transaction rolls back and the old Recap stays.

Before writing, it reads whether a previous Recap existed, so it can decide whether to append `recap.milestone` (`available` on the first generation with data, `closed` when `final` is set and there is data).

The Recap id changes on every regeneration. Nothing references `year_recap.id` outside its own children.

The Recap cache key `recap_by_user_*` is cleared after each write. Reads are cached for 15 minutes, which is acceptable for a page that updates daily.

### 11. Choosing which users to regenerate
The daily scheduler (`0 4 * * *`) now enqueues users in these cases:
- The current year is live:
  - eligible users with no Recap for the year;
  - users whose Recap `updatedAt` is older than their latest `user_playtime_history.createdAt`, `collection_entry.updatedAt` or `review.updatedAt`.
  - This uses one SQL query with `EXISTS` subqueries, which the existing `(profileUserId, createdAt)` indexes support.
- The previous year is closed and still has non-final Recaps (normally from 1 Jan): every eligible user with no final Recap for that year, enqueued with `final: true`.

`findRelevantProfiles` replaces `profileService.findAll()` with a paged id query, because loading every profile with lockout states each day does not scale.

Processor concurrency rises from 1 to 4 through a constant. A Recap uses a few indexed queries, and 4 keeps the load on the shared MySQL modest. This is a shortcut, and the code says so. Upgrade it when the daily run exceeds 2 h.

### 12. Recap entity additions
- `year_recap` gains these columns: `totalFinishedGames`, `totalDroppedGames`, `isFinal` (bool, default false), `dailyPlaytimeSeconds` (json, nullable for old rows) and `communityHighlights` (json, nullable).
- `year_recap_played_game` gains these columns: `firstPlayedAt` (date, nullable), `finishedAt` (datetime, nullable) and `rating` (float, nullable).
- `YearRecapDto` gains fields derived on read:
  - `backlogGrowth`;
  - `calendar`, containing `monthlyPlaytimeSeconds[12]`, `topMonth`, `longestStreak {start, end, days}`, `topWeekday {weekday, share}` and `weekendShare`;
  - `topGames`, aggregated per game with `{gameId, platformIds, totalPlaytimeSeconds, share, firstPlayedAt, finishedAt, rating}`;
  - `playtimeByPlatform`, as `{platform, totalPlaytimeSeconds, share}`.
  - The existing fields stay unchanged.
- Recaps made before this change have `dailyPlaytimeSeconds = null`. The read then returns `calendar = null`, and clients treat that as "no calendar".

### 13. Community highlights
At generation time:
- The candidates are the user's reviews of games in the Recap's played set.
- One query per Recap computes, for each candidate game, the average rating of the other reviewers, their count, the count rated at or beyond the user's rating (in the direction away from the average), and the count within ±0.5 of the user's rating. It uses `GROUP BY gameId` over `review` with `profileUserId <> ?` and `HAVING COUNT(*) >= 20`.
- Minority is the game with the largest `|user − avg|`, and in-tune the game with the smallest. When only one game qualifies, it is reported as minority if `|user − avg| >= 1` and as in-tune otherwise.
- The result is stored as JSON, `{minority, inTune}`, and each entry is `{gameId, userRating, communityAverage, reviewCount, beyondShare, sameRangeCount}`.

Computing this on read was rejected because it scans reviews of popular games on every page view.

The threshold of 20 reviews is a constant.

### 14. Goals
The new table is `year_goal (profileUserId, year, finishedGamesTarget, createdAt, updatedAt)` with primary key `(profileUserId, year)` and an FK cascade on profile. The PUT upserts. The GET returns `{year, target | null, finished}`, where `finished` counts `collection_entry.finishedAt` within the year (UTC).

Both routes go in `RecapController` and are declared before `:year/:userId`. Otherwise `recap/goals/2027` would match that route.

The July reminder is a scheduler on the recap queue that runs at 12:00 UTC on 1 July. It creates the `goal:<year>:july` campaign, and the awards tick's campaign runner processes it. That runner is extracted into a small `NotificationCampaignService` in `src/notifications`. The Awards and Recap modules each call it independently with their own campaign keys and recipient queries.

### 15. Ballot completion metric
Add `awards_ballot_completed` next to `awards_participation`:

```sql
SELECT LEAST(COUNT(DISTINCT v.categoryId) = (SELECT COUNT(*) FROM awards_category c WHERE c.eventId = ae.id), 1) ...
```

It accepts the same `year` filter. `registerVote` calls `addTrackingJob` for both metrics. The admin creates the "Awards 2026" definition with this metric, the year filter 2026, the event window, and +1000 XP. That is an operations task, and no code seeds it.

## Risks / Trade-offs

- [Daily attribution uses the observation time, so a Steam sync at 04:00 records the previous night's play on the next day] → Document it as an estimate, as the playtime-history spec already does. The streak and weekday highlights are approximate, which is acceptable for a Recap.
- [Users who connected a provider late in the year have no baseline, so earlier play is missing] → This is existing period-estimate behavior. Played games still come from library dates, and the share card states which sources were counted.
- [Each milestone fan-out writes one outbox row per user] → The fan-out runs in batches of 1000, at most 20k per tick. The relay already handles bounded claims, so watch the outbox backlog on milestone days.
- [The hourly tick can send "voting opens" up to 59 minutes late] → Acceptable. The dates are day-granular in the design.
- [The vote restriction rejects requests from clients that still offer free search in 2026 categories] → It applies only to events with nomination dates, and the hand-off tells clients to switch.
- [Regeneration changes the Recap id] → Nothing references it. The tasks include a test that the public read by `(userId, year)` keeps working across regenerations.
- [The duplicate-result cleanup in the migration deletes rows] → It deletes only exact duplicates per category and keeps the first. `down` cannot restore them, so take a database backup before deploying.
- [Concurrency 4 on Recap jobs adds MySQL load] → Make it a constant with a `shortcut:` comment, and watch the job duration on 15 Nov.

## Migration Plan

1. Deploy the migration and code as soon as they are ready. The change is planned on 15 Nov 2026, after the design's own dates, so no date is hard-coded.
2. An admin updates the 2026 event with the agreed calendar, for example nominations 20–28 Nov, voting 1–20 Dec and results 27 Dec. The admin also sets `eligibilityCutoffDate` to 30 Nov, creates the 12 categories with `nomineeCount`, and creates the "Awards 2026" achievement with `awards_ballot_completed`.
3. An admin sets the 2026 Recap opening with `PUT /v1/recap/admin/editions/2026`. Without a row, the Recap is live as soon as the code is deployed, because 15 Nov has already passed.
4. Hand the client document to the web and mobile teams.
5. Rollback: revert the code. The new columns are nullable or have defaults, and the new tables are unused by the old code. The unique index on `awards_category_result.categoryId` is compatible with the old processor except on results day, which falls after the rollback window.

## Open Questions

- What exact copy should the milestone notifications use? Clients render it from `milestone`, so it does not affect the server.
- What value should `nomineeCount` take for each category besides GOTY? It is admin data.
