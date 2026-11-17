# Proposal

## Why

The Daily design "GameNode Daily · Ranking (Sam)" (Figma `ikcThguwowTdynGz0L2YkS`, section `5050:13680`) turns the four daily puzzles into a competition: a ranking page filtered by mode, period and scope, a ranking panel on the hub, a "+N pts" card on the result screen, and two new ways to play from the hub ("Ilimitado" for Cover and Specs, and a weekly "Desafio da semana" ranked among friends). Today the server only stores each player's result per puzzle. It has no points, positions, streaks, weekly puzzle or practice rounds, so none of these screens can be built.

## What Changes

- Score every daily result that a signed-in player finishes on the puzzle's own day: Cover, Artwork and Keywords give 6 points on the first attempt down to 1 on the sixth; Specs gives 0.6 per remaining life (6 to 0.6); a loss gives 0; skips and the Specs hint count as attempts; archive plays give 0; finishing all four modes on the same day adds a 2-point bonus. Results created by `POST /v1/daily/results/import` never score.
- Backfill points for existing results that were finished on their puzzle's day, so the "Sempre" ranking and streaks are not empty at launch.
- Add a public `GET /v1/daily/ranking` with period (`today`, `week`, `month`, `all`), optional mode, scope (`all`, `following`), pagination, position change since yesterday, current streak, per-mode points in the overall view, solved/average attempts/best streak in a mode view, win rate, period end, total players and the viewer's own row with the gap to the top 100. Banned and suspended users are left out. Supporters are marked for the "Premium" badge; supporters gain no points advantage.
- Add a `ranking` block to the finished `POST /v1/daily/puzzles/:id/play` response with the points earned, the bonus, and the viewer's weekly position before and after.
- Add a weekly challenge: one hard Specs-style puzzle per week (Monday to Sunday, São Paulo), 10 attempts, exposed on `GET /v1/daily` and played through the existing play endpoint, plus `GET /v1/daily/weekly/ranking` ranking the viewer against the people they follow. It never gives daily ranking points.
- Add unlimited practice for Cover and Specs: `POST /v1/daily/practice` starts a round with a random answer and `POST /v1/daily/practice/:id/play` plays it with the same rules and feedback as the daily. Practice never scores, never appears in results or archive, and never uses an answer reserved for today or later.
- Generate a web/mobile client hand-off as the final task. Client implementation is not part of this change.

Not included: client UI; seasons, monthly resets with medals, or archived past rankings; minimum time per guess and flagging new accounts with a 100% win rate; practice for Artwork and Keywords; practice history or statistics; a friends list separate from GameNode follows; notifications about rank changes.

## Capabilities

### New Capabilities

- `daily-ranking`: How daily results earn points, which results count, and how players are ranked, filtered, compared over time and summarized.
- `daily-weekly-challenge`: The weekly puzzle's calendar, availability, play rules and the ranking among followed players.
- `daily-practice`: Unlimited practice rounds: who can start and play them, which answers they may use, what they never affect, and how long they are kept.

### Modified Capabilities

- `daily-answer-selection`: Adds the answer pools for the weekly challenge and for practice rounds, and how both interact with repeat avoidance and existing daily reservations.

## Impact

- **API**: new `GET /v1/daily/ranking`, `GET /v1/daily/weekly/ranking`, `POST /v1/daily/practice`, `POST /v1/daily/practice/:id/play`; additive `weekly` on `GET /v1/daily` and additive `ranking` on the play response. `GET /v1/daily/images/:token` also serves practice images. Archive, results and import keep their shapes and only ever list daily puzzles.
- **Code**: `src/daily` (service split into ranking, weekly and practice services, scheduler, pool service, evaluator input type, image token, DTOs, controller), reads from `src/follow`, `src/billing` (supporter ids), `src/profile` (username, avatar, badge preference) and `src/auth` (banned/suspended user ids).
- **Database**: one migration: `kind` column on `daily_puzzle` with uniqueness per kind, `ranked` and `points` columns on `daily_result` with the backfill, a ranking index, a new `daily_practice_round` table, and the derived `daily_ranking_entry` (per-player totals per current period, recomputed from results on each counted finish and rebuilt on first boot) and `daily_ranking_snapshot` (previous positions) tables.
- **Clients**: additive. Web and mobile build the ranking page, hub panel, result card, weekly challenge and practice through the hand-off.
