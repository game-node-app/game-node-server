# Tasks

## 1. Schema

- [x] 1.1 Write one raw-SQL migration that does the following:
  - adds to `awards_event`: `nominationStartDate`, `nominationEndDate` and `eligibilityCutoffDate`, all nullable;
  - adds to `awards_category`: `nomineeCount` (default 6) and `nomineesFinalizedAt`;
  - adds to `awards_category_result`: `totalPlayedVotesCount` (default 0);
  - adds to `awards_category_result_winner`: `playedVotes` and `playedVotesPercentage` (default 0);
  - adds to `year_recap`: `totalFinishedGames`, `totalDroppedGames`, `isFinal`, `dailyPlaytimeSeconds` json and `communityHighlights` json;
  - adds to `year_recap_played_game`: `firstPlayedAt`, `finishedAt` and `rating`;
  - creates the tables `awards_nomination`, `year_recap_edition`, `year_goal` and `notification_campaign`;
  - deletes duplicate `awards_category_result` rows and their winners, keeping the lowest id per category, then adds `UNIQUE(categoryId)`.

  Update the matching entities. Verify that `up` and `down` run on a clean MySQL database, and with an integration test that seeded duplicates collapse to one result per category.

## 2. Awards events and nominations

- [x] 2.1 Add the pure `getAwardsPhase(event, now)` and `assertGameEligible(event, game)` (design 1, 3). Add the date-order validation and the new fields to `CreateUpdateAwardsEventDto`, and `nomineeCount` to the category DTO. Verify with unit tests for every phase boundary, a legacy event with no nominations, the cutoff, a null release date, and an admin save with out-of-order dates returning 400.
- [x] 2.2 Add `phase` and the dates to every event read, and add `GET /v1/awards/events/current`, declared before `events/:id`. Fix the processor so it no longer relies on `getRunningEvent`, which filters by year. Verify with tests for the January lookup, a future 2027 event being ignored, 404 when no event has started, and `events/:id` still resolving.
- [x] 2.3 Add `PUT /v1/awards/:eventId/nominations/:categoryId` and `GET /v1/awards/:eventId/nominations/me` (design 3). Verify with tests for replace, clear, 4 games, duplicate ids, the personal-GOTY category, outside the phase, ineligible games, 401, and a GET returning every nominations-enabled category in order.
- [x] 2.4 Implement nominee finalization (design 2). Verify with an integration test covering top-N with ties broken by game id, fewer games than slots, an admin-curated category left untouched, a repeated run changing nothing, and the public categories read returning the finalized nominees in `suggestions`.

## 3. Ballot

- [x] 3.1 Add `getUserPlayContext(userId, gameIds)` with the played, planned and not-played rules (design 6). Verify with tests for playtime only, finished without playtime, planned, dropped, a started date, a rating with no library entry, and unknown games.
- [x] 3.2 Restrict `registerVote` to nominees for events with nominations, keep personal GOTY open, use `assertGameEligible`, fix the "before start" message, and trigger the tracking jobs for `awards_participation` and `awards_ballot_completed`. Verify with tests for a non-nominee rejected, personal GOTY accepted, a legacy event unchanged, a vote before the start, a vote after the end, and both tracking jobs enqueued.
- [x] 3.3 Add `GET /v1/awards/:eventId/ballot`, with progress, played counts and the personal-GOTY suggestion (design 6). Verify with an integration test of a 12-category ballot with 7 votes and 4 of 6 GOTY nominees played, the suggestion tie-break, a null suggestion, and 401 without a session.
- [x] 3.4 Add the public `GET /v1/awards/:eventId/votes/:userId`. Verify with tests for a user with votes, a user without votes, and an unknown event returning 404.
- [x] 3.5 Add the `awards_ballot_completed` metric (design 15). Verify with a metrics integration test for a complete ballot (1), an incomplete ballot (0), an event with no categories (0), and the admin catalog listing it with the `year` filter.

## 4. Results and lifecycle tick

- [x] 4.1 Rewrite result processing as a single transaction per event that computes `votes`, `playedVotes`, the ranking tie-breaks and `totalPlayedVotesCount` (design 5). Verify with an integration test for the played-only shares (the 174 of 600 example), a vote tie decided by played votes, zero played votes, and a second run not adding results.
- [x] 4.2 Replace the 6-hourly result scheduler with the hourly lifecycle tick: finalize nominees, compute results on or after `resultsDate`, then run campaigns (design 4). Verify with tests for a missed results day, results not computed before `resultsDate`, events outside the 40-day window skipped, and the scheduler id upserted with the new pattern.
- [x] 4.3 Add the public `GET /v1/awards/:eventId/scoreboard/:userId` (design 7). Verify with an integration test for 7 hits, 1 miss and 3 not voted out of 11, the personal-GOTY count excluding the user, a null personal GOTY, and 404 before results.

## 5. Event notifications

- [x] 5.1 Add the `awards.milestone`, `recap.milestone` and `goal.reminder` event types, their projector cases resolving to separate `awards`, `recap` and `goal` destinations, and the three target DTOs (design 8). Verify with projector tests for each type and milestone, and an inbox read that renders them with no extra requests.
- [x] 5.2 Add `NotificationCampaignService` with the batched, resumable fan-out over the cursor, the banned and suspended exclusion, per-milestone recipient filters, and the 20-batch limit per tick (design 8). Verify with integration tests for an interrupted fan-out resuming at the next batch, a rerun sending nothing, banned and suspended users excluded, the nominations reminder skipping users who nominated, and the voting reminder skipping complete ballots.
- [x] 5.3 Wire the Awards milestones into the tick with their trigger times and staleness rules. Verify with tests for a late but valid milestone sent once, stale milestones skipped, and "results published" waiting for results to exist.

## 6. Recap

- [x] 6.1 Add `year_recap_edition`, `getRecapWindow` and `getCurrentRecap` with the 60 s cache, the admin `PUT /v1/recap/admin/editions/:year`, and `GET /v1/recap/current`. Add `phase` to the status read and replace `getTargetRecapYear` everywhere (design 9b). Verify with tests for the default 15 Nov, a stored later opening, before opening, after year end, an `opensAt` outside the year returning 400, a non-admin returning 403, and the cache cleared after a PUT.
- [x] 6.2 Add `PlaytimeHistoryService.getDailyPlaytimeForPeriod` (design 9). Verify with tests mirroring the period-estimate scenarios (a baseline before the period, a first-ever sample contributing 0, a correction), with the increments landing on the day they were observed, and with its daily sum equal to `getTotalPlaytimeForPeriod` for the same period.
- [x] 6.3 Make `createRecap(userId, year, {final})` delete and insert in one transaction, clear the read cache, and append `recap.milestone` on the first generation with data and on finalization with data (design 10). Verify with integration tests for a second generation with no unique-index error, a forced failure leaving the old Recap readable, notifications sent only once and never for empty recaps, and a final Recap never regenerated.
- [x] 6.4 Extend generation with these values, then verify with an extension of `recap-create.statistics.integration.spec.ts` that asserts each value from seeded data:
  - the finished and dropped counts;
  - `dailyPlaytimeSeconds`;
  - per played game, `firstPlayedAt` (falling back to the library start date), `finishedAt` and `rating`;
  - the community highlights with the 20-review threshold (design 13).
- [x] 6.5 Add the read-side derivations `deriveCalendarHighlights`, `topGames`, `playtimeByPlatform` and `backlogGrowth` (design 12). Verify with unit tests for the 2–24 Mar streak, a leap year with 366 days, no playtime giving nulls, the same game on two sources merging, the floor at zero, and an old Recap with null daily data returning `calendar = null`.
- [x] 6.6 Change the daily scheduler's user selection to cover missing Recaps, users active since their last generation, and finalization of the closed year. Use paged id queries and set processor concurrency 4 with a `shortcut:` comment (design 11). Verify with an integration test that only the expected users are enqueued in the live, closed and no-changes cases, and that a closed year enqueues `final: true` jobs.

## 7. Goals

- [x] 7.1 Add `GET` and `PUT /v1/recap/goals/:year`, declared before `:year/:userId` (design 14). Verify with tests for save and replace, a past year, 0 and 1000 returning 400, a null target with progress, 401, and `GET /v1/recap/2026/:userId` still resolving.
- [x] 7.2 Add the 1 July scheduler that creates the `goal:<year>:july` campaign, with only users who have a goal as recipients. Verify with a test that a double run sends one reminder per user with the target and finished counts.

## 8. Client hand-off

- [x] 8.1 Write `openspec/changes/add-2026-recap-and-awards-events/handoff-clients.md`. Map each design frame to its endpoints and fields:
  - the Home event cards per phase;
  - the Dock;
  - the Recap web sections;
  - the five stories;
  - the ballot, web and mobile;
  - the results and scoreboard;
  - the notifications.

  It must also cover the scale conversion from 0–5 to 0–10, ids-only game data, `planned` shown as "lista de desejos", the logged-out behavior, and the vote restriction. Verify that every screen in the Figma file is listed with its data source.

## 9. Integration

- [x] 9.1 Run `openspec validate add-2026-recap-and-awards-events --strict` and match each scenario in the seven specs to a passing test or a recorded manual check, listing any gap.
- [x] 9.2 Run `yarn build`, the unit suite and the affected integration suites (awards, recap, playtime, notifications, achievements), and verify they pass.

## Workflow follow-up

- Operations after deploy:
  - set the 2026 Awards calendar and `eligibilityCutoffDate`, the categories and `nomineeCount`, and the Recap opening;
  - create the "Awards 2026" achievement with `awards_ballot_completed` and +1000 XP.
- Archive the change after review.
