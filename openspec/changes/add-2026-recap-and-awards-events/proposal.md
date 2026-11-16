# Proposal

## Why

The 2026 design ("Eventos 2026 · Retrospectiva + Awards") plans two separate events whose schedules overlap at the end of the year. The Awards run nominations, then voting, then results. The Recap opens in mid-November and updates every day until 31 December. Each event has its own data, calendar, phases and endpoints, and neither one's lifecycle depends on the other. The Awards gain a community nominations phase, and the ballot shows what each voter actually played. The results get a "played only" view and a personal score. The server supports none of this today:

- The Recap opens only in December, is generated once per user and never refreshed. It has no daily or monthly playtime, finish dates, ratings, backlog numbers or community comparison.
- Awards events have no nominations phase. A vote accepts any game released that year. Ballots do not report play status, progress or a personal-GOTY suggestion. Results have no played-only breakdown and no per-user score, and the result job can store a category result more than once.
- No notification exists for Awards or Recap milestones.

The web and mobile clients need every endpoint and field in place before 3 November so they can build the Home event cards, the Dock entries, the screens and the stories.

## What Changes

**Awards**
- Add nomination dates and an optional release cutoff (for example, "released between 1 Jan and 30 Nov") to `AwardsEvent`. Expose a derived `phase` (`upcoming`, `nominations`, `nominations_closed`, `voting`, `voting_closed`, `results`) and add `GET /v1/awards/events/current`.
- Add community nominations: each user can nominate up to 3 eligible games per category, except the personal GOTY. Add `GET /v1/awards/:eventId/nominations/me` and `PUT /v1/awards/:eventId/nominations/:categoryId`.
- When nominations close, finalize each category's nominees from the most-nominated games. The default is 6 per category and is configurable. Nominees reuse the existing admin-managed `AwardsCategorySuggestion` table, so admins can still adjust them.
- **BREAKING (events with a nominations phase only)**: `POST /v1/awards/vote` rejects games that are not nominees, except in the personal GOTY category. Events without nomination dates (2025 and earlier) keep today's rules.
- Add `GET /v1/awards/:eventId/ballot`, an authenticated read. For each category it returns the user's vote, and for each nominee it returns the user's play status (`played` / `planned` / `not_played`), hours and rating. It also returns played-nominee counts, ballot progress and a personal-GOTY suggestion.
- Add a public `GET /v1/awards/:eventId/votes/:userId` so a ballot can be shared.
- Add an achievement metric `awards_ballot_completed`, which is 1 when a user voted in every category of that year's event. Admins configure the "Awards 2026" achievement with it.
- Make result processing idempotent and run it on or after `resultsDate` instead of only on that exact day. Store played-only vote counts and percentages for each winner row.
- Add a public `GET /v1/awards/:eventId/scoreboard/:userId` with hit, miss or not-voted for each category, the "X of Y" totals and how many people share the user's personal GOTY.

**Recap**
- The Recap for year Y opens at an opening time stored per year. Admins can edit it through `PUT /v1/recap/admin/editions/:year` without a deploy, and it defaults to 15 November. It is `live` (regenerated daily for users with new activity) until 31 December and `closed` from 1 January, after one final regeneration. Add `GET /v1/recap/current` and a `phase` on the status read.
- Fix regeneration. Today a second generation for the same user and year collides with the unique index.
- Extend the Recap read with:
  - finished and dropped counts and the backlog growth;
  - daily playtime for the year, plus derived monthly totals, top month, longest play streak, top weekday and weekend share;
  - per-game first-played date, finish date and the user's rating;
  - top games aggregated per game, and hours per platform;
  - a "you vs. the community" highlight with a minority opinion and an in-tune game.
- Add yearly goals with `GET` and `PUT /v1/recap/goals/:year` (finished-games target plus current progress) and a July reminder.

**Notifications**
- Add Awards milestone notifications: nominations open, nominations close tomorrow, voting open, voting closes in 2 days (incomplete ballots only) and results out. Their destination is the Awards event.
- Add Recap notifications (your Recap is here, your year closed) and the goal reminder. Their destinations are the Recap and the goal.
- All of them go through the existing outbox. Notifications sent to many users fan out in batches that resume after interruption.

The Awards and the Recap share no entity, table, phase model or endpoint. They only use the same notification infrastructure. A Recap cross-link to the ballot is a client composition of two separate reads.

**Hand-off**
- Write a client hand-off document that maps every design screen and state to the endpoints and fields above.

Not included: client UI; rendering share images or stories (clients render them); the Dock "new" badge state (client-local); difficulty level ("no difícil"), which no provider supplies; OG and preview pages.

## Capabilities

### New Capabilities

- `awards-events`: Event dates and phases, the current event, community nominations and nominee finalization.
- `awards-ballot`: The ballot read with personal play context, vote eligibility rules, ballot sharing and ballot completion.
- `awards-results`: Idempotent result computation, the played-only breakdown and the per-user scoreboard.
- `year-recap`: The Recap window and phases, daily regeneration and finalization, and the data the Recap exposes.
- `year-goals`: Per-user yearly finished-games goals, their progress and their reminder.

### Modified Capabilities

- `notification-delivery`: Adds system-generated Awards, Recap and goal notifications, each with its own destination, and batched, resumable, deduplicated fan-out for notifications sent to many users.
- `achievement-catalog`: Adds the `awards_ballot_completed` metric to the closed metric catalog.

## Impact

- **Code**: `src/awards/**` (entities, DTOs, services, controllers, the result processor and a new lifecycle tick replacing the result-only scheduler), `src/recap/**` (generation, queue, DTO, utils, goals), `src/playtime/playtime-history.service.ts` (daily increments), `src/achievements/metrics/achievement-metrics.ts`, `src/notifications/**` (event types, projector, destination DTO).
- **Database**: one MySQL migration. It adds columns to `awards_event`, `awards_category`, `awards_category_result`, `awards_category_result_winner`, `year_recap` and `year_recap_played_game`. It adds the tables `awards_nomination`, `year_recap_edition`, `year_goal` and `notification_campaign`. It deduplicates existing `awards_category_result` rows before adding a unique index on `categoryId`.
- **APIs**: new endpoints listed above. Existing response shapes only gain fields. The vote restriction is the only behavior change, and it applies only to events with a nominations phase.
- **Load**: daily Recap regeneration from 15 Nov to 31 Dec, limited to users with activity since their last generation. Milestone fan-out inserts one outbox row per recipient, in batches.
- **Operations**: the change is planned on 15 Nov 2026, after the dates in the design (nominations 3–16 Nov, Recap on 15 Nov). The dates are therefore data, not code. Once deployed, admins must:
  - set the 2026 event's nomination and voting dates (for example, nominations 20–28 Nov and voting 1–20 Dec);
  - set the Recap opening;
  - set the categories and `nomineeCount`;
  - create the "Awards 2026" achievement with the new metric.
