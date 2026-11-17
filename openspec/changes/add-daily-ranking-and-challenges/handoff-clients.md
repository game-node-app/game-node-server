# Client hand-off: daily ranking and challenges

Server-side implementation of `add-daily-ranking-and-challenges` is complete. Client implementation is a
**separate change in `game-node-clients`** and is not part of this server change.

This document is the contract for that client work. Every endpoint, query parameter, field, default and
status below was checked against the implemented DTOs (`src/daily/dto/*.ts`,
`src/daily/daily.controller.ts`) and against the regenerated `server_swagger.json`.

Regenerate the client from `server_swagger.json`. All routes are under `/v1` and use the normal Better
Auth session (cookie or `Authorization: Bearer <token>`). A protected call without a session returns
401. Public routes never return 401 and treat a missing session as anonymous.

## 1. Conventions

- **Points are decimals with one place.** The API returns JSON numbers (`4`, `2.4`, `6`); the design
  shows `4,0` / `2,4` / `6,0`. Format with one decimal in the client (`value.toFixed(1)`), using the
  locale's decimal separator. Do not round on the server and do not add a bonus yourself.
- **São Paulo dates.** Daily puzzle dates (`YYYY-MM-DD`), the week (Monday to Sunday), the month and the
  day a result counts for are all São Paulo calendar dates. `endsAt` and `nextResetAt` are ISO instants
  with the São Paulo midnight (`-03:00`). Do not apply the viewer's timezone to a puzzle date. A
  `date` string is a calendar day, not an instant.
- **Ranking freshness: the next read.** No ranking list is cached. A counted finish is visible to every
  ranking read as soon as its play request commits, and the viewer's own play response always includes
  the result just finished. Bans and suspensions leave the list within 60 s (the server caches the
  locked-id list for that long) without shifting anyone else's position. `positionChange` compares with
  a snapshot of the same period without today's puzzles, taken at 00:00 São Paulo: it is `null` on every
  row until that snapshot is ready, always `null` for `period=today`, and `"new"` when the player has no
  position in the snapshot.
- **One ranking list per period and mode.** `period`, `mode` and `scope` all change the list and its
  positions; `mode` rows carry different fields from overall rows (section 3).
- **Weekly challenge and practice are outside the daily ranking.** Neither adds daily points nor appears
  in the daily ranking, the four-puzzle list, the archive or streaks. Weekly results are stored and
  appear in the results read only with `kind=weekly`; practice never creates a result at all.
- **Base timestamps.** Entities that extend the server's base entity also return `createdAt`,
  `updatedAt` and `deletedAt`; the tables below list only the meaningful fields.
- **Statuses.** Success responses follow the controller defaults: `GET` 200 and `POST` 201. Validation
  errors are 400, missing session on a protected route 401, ownership 403, unknown/expired resource
  404, rate limit 429, no practice candidate 503.

## 2. Endpoint index

| Method | Path | Auth | Used by |
| --- | --- | --- | --- |
| GET | `/v1/daily` | public | Hub, daily list, weekly entry |
| GET | `/v1/daily/ranking` | public | Ranking web and mobile, hub ranking panel, guest read |
| GET | `/v1/daily/weekly/ranking` | session | Weekly challenge friends ranking |
| POST | `/v1/daily/practice` | public | Practice start (Cover, Specs) |
| POST | `/v1/daily/practice/{id}/play` | public | Practice play |
| POST | `/v1/daily/puzzles/{id}/play` | public | Daily and weekly play, result screen ranking card |
| GET | `/v1/daily/archive` | public | Existing archive (unchanged, daily only) |
| GET | `/v1/daily/results` | session | Existing results list; new `kind` filter |
| POST | `/v1/daily/results/import` | session | Existing guest import (weekly included, never ranked) |
| GET | `/v1/daily/images/{token}` | public | Existing image endpoint, also serves practice tokens |

Success and error statuses:

| Endpoint | Success | Errors the client should handle |
| --- | --- | --- |
| `GET /v1/daily` | 200 | — |
| `GET /v1/daily/ranking` | 200 | 400 invalid query; 401 `scope=following` without a session |
| `GET /v1/daily/weekly/ranking` | 200 | 401 without a session |
| `POST /v1/daily/practice` | 201 | 400 invalid mode; 429 rate limit; 503 no candidate |
| `POST /v1/daily/practice/{id}/play` | 201 | 400 invalid body or non-growing progress; 403 another account's round; 404 unknown/expired round |
| `POST /v1/daily/puzzles/{id}/play` | 201 | 400 invalid body or non-growing progress; 404 unknown or future puzzle |
| `GET /v1/daily/archive` | 200 | 400 invalid query (existing behavior) |
| `GET /v1/daily/results` | 200 | 400 invalid `mode`/`kind`; 401 without a session |
| `POST /v1/daily/results/import` | 201 | 400 invalid body; 401 without a session |
| `GET /v1/daily/images/{token}` | 200 (`image/webp`) | 403 tampered token; 404 missing/expired source; 503 upstream image failure |

## 3. `GET /v1/daily/ranking` (public)

The ranking page, the hub panel (`limit=3`) and the logged-out screen all read this endpoint.

| Query | Type | Default | Bounds / values |
| --- | --- | --- | --- |
| `period` | string | `week` | `today`, `week`, `month`, `all` |
| `mode` | string | absent (overall) | `cover`, `artwork`, `keywords`, `specs` |
| `scope` | string | `all` | `all`, `following` |
| `offset` | integer | `0` | `>= 0` |
| `limit` | integer | `20` | `1..100` |

- `period=week` is Monday 00:00 to Sunday 23:59:59 São Paulo; `month` is the calendar month; `today`
  is the current puzzle day; `all` has no start.
- A period only includes puzzles dated inside it and never after today.
- `scope=following` contains the viewer plus the players the viewer follows, with positions renumbered
  inside that set. Without a session it responds **401**. `scope=all` is public.
- An unknown `period`, `mode` or `scope`, `limit` 0 or 101, or a negative `offset` responds **400**.

Response:

```json
{
    "period": "week",
    "mode": null,
    "scope": "all",
    "endsAt": "2026-11-23T03:00:00.000Z",
    "totalPlayers": 14237,
    "viewer": {
        "position": 142,
        "positionChange": 3,
        "userId": "f0e1...",
        "username": "player",
        "avatar": null,
        "supporterBadge": false,
        "points": 108.4,
        "winRate": 71.4,
        "modePoints": { "cover": 32, "artwork": 24, "keywords": 30, "specs": 22.4 },
        "currentStreak": 5
    },
    "pointsToTop100": 3.8,
    "data": [
        {
            "position": 1,
            "positionChange": "new",
            "userId": "8a7c...",
            "username": "leader",
            "avatar": { "id": 12, "filename": "x.png", "mimetype": "image/png" },
            "supporterBadge": true,
            "points": 112.2,
            "winRate": 100,
            "modePoints": { "cover": 30, "artwork": 28, "keywords": 30, "specs": 24.2 },
            "currentStreak": 7
        }
    ],
    "pagination": { "totalItems": 14237, "totalPages": 712, "hasNextPage": true }
}
```

Overall row fields (no `mode` query):

| Field | Type | Meaning |
| --- | --- | --- |
| `position` | number | Consecutive position in the filtered list, starting at 1. |
| `positionChange` | number \| `"new"` \| null | `previous - current`, so positive means the player moved **up**. `"new"` when the player has no entry in the same list without today's puzzles. `null` for `period=today` and for every row until today's previous-position snapshot is ready. |
| `userId` | string | Player id, for profile links. |
| `username` | string | Profile username. |
| `avatar` | object \| null | The same avatar object returned by profile reads, or null. |
| `supporterBadge` | boolean | Entitled supporter who did not hide the badge. Display only; no ranking advantage. |
| `points` | number | Period points with one decimal; on overall rows the completion bonus is included. |
| `winRate` | number | Counted wins / counted results × 100, one decimal (0–100). A loss-only player shows 0. |
| `modePoints` | `{ cover, artwork, keywords, specs }` | One decimal each; the four are the mode breakdown of `points`. The completion bonus is added to `points` only, so the four can sum to less than `points`. |
| `currentStreak` | number | Consecutive São Paulo days, ending today or yesterday, with at least one counted win; 0 when broken. |

Mode row fields (any `mode` query) replace `modePoints`/`currentStreak` with:

| Field | Type | Meaning |
| --- | --- | --- |
| `wins` | number | Counted wins in that mode and period. |
| `averageAttempts` | number \| null | Average attempts over counted wins in that mode and period, one decimal; null without a counted win. |
| `bestStreak` | number | Longest run of consecutive days with a counted win in that mode, over all time. |

Response fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `period` | string | Echoes the requested period. |
| `mode` | string \| null | Echoes the requested mode; null in the overall ranking. |
| `scope` | string | Echoes the requested scope. |
| `endsAt` | string \| null | Instant the period ends: `today` → next midnight São Paulo; `week` → next Monday 00:00 São Paulo; `month` → first day of the next month 00:00 São Paulo; `all` → null. |
| `totalPlayers` | number | Ranked players after `scope`; the same number as `pagination.totalItems`. |
| `viewer` | row \| null | The viewer's own row, even outside the page. Null for guests, for signed-in players without a counted result in this list, and for a banned or suspended viewer. |
| `pointsToTop100` | number \| null | Points between the viewer and position 100 on the same scoped list, one decimal; null when the viewer is inside the top 100, has no viewer row, or the list has fewer than 100 ranked players. |
| `data` | row[] | Exactly the requested page. When the viewer is outside it, the viewer row exists only in `viewer`. |
| `pagination` | object | `{ totalItems, totalPages, hasNextPage }` over the scoped list. |

Who appears and how positions work:

- Every player with at least one counted result in the period and filter, including a player whose only
  counted result was a loss (0 points).
- Banned and suspended players are removed before positions are assigned. Deleted accounts do not appear:
  their ranking rows are removed with the account.
- Ordering: points descending, then fewer total attempts across counted wins, then earlier last counted
  finish, then `userId` ascending. Positions are consecutive with no shared places.

Points rules the server applies (do not recompute in the client):

- Only a signed-in player's daily result finished through the play endpoint **on the puzzle's own São
  Paulo day** counts. Archive plays, finishes after midnight, imported guest results, weekly challenges
  and practice never count. Whether a result counted is fixed when it finishes.
- Cover, Artwork and Keywords: `7 - attempts` on a win (6 on the first attempt down to 1 on the sixth).
- Specs: `0.6 × remaining lives` = `0.6 × (11 - attempts)` (6 on the first attempt down to 0.6 on the
  tenth).
- Skips and the Specs hint count as attempts. A loss earns 0 but counts as played for the win rate.
- Overall ranking only: a **+2 completion bonus** for each São Paulo day with counted wins in all four
  modes. The bonus is part of `points` and does not appear in `modePoints`; the play response tells the
  client when this result earned it.

### `kind` on the existing results read

`GET /v1/daily/results` is session-only (401 without a session) and keeps its existing shape. New
optional `kind`: `daily` (default) or `weekly`. `mode` remains optional. Weekly results appear only with
`kind=weekly`.

## 4. `POST /v1/daily/puzzles/{id}/play` — ranking block

The existing daily play endpoint adds a `ranking` object to finished results:

```json
{
    "ranking": {
        "counted": true,
        "pointsEarned": 4,
        "bonusEarned": 0,
        "weekPoints": 32,
        "weekPosition": 14,
        "previousWeekPosition": 15,
        "pointsToTop100": 8.4
    }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `counted` | boolean | Whether this result counts for the daily ranking. |
| `pointsEarned` | number | Points for this result, one decimal; 0 for a loss or an uncounted finish. |
| `bonusEarned` | number | 2 or 0; the completion bonus belongs to the mode that finished last on the result's own puzzle day. |
| `weekPoints` | number | The viewer's week points including this result; 0 when the viewer has no counted result this week. |
| `weekPosition` | number \| null | The viewer's week position in the overall week list after this result; null when the viewer has no counted result this week. |
| `previousWeekPosition` | number \| null | The position before this result; null on the player's first counted result this week (the design's “new”) and when the viewer has no counted result this week. A reopened result from a past week reports its own `pointsEarned`/`bonusEarned` and `previousWeekPosition` equal to `weekPosition`, because it does not change this week's entry. |
| `pointsToTop100` | number \| null | Same rule as the ranking page, for the viewer's week position. |

The block is **absent** for guests, unfinished plays and weekly puzzles. A finished result reopened later
returns the same `pointsEarned` and `bonusEarned` (points are not counted again); its week fields describe
the current week, not the week of the puzzle. Archive finishes return `counted: false` and zero points and
bonus, with the week fields above: the current week position, unchanged, or `weekPoints: 0` and null
positions when the viewer has no counted result this week.

The rest of the play response is unchanged. For the result screen, show the “+N pts” card from
`pointsEarned` plus `bonusEarned` and the before/after position from `previousWeekPosition` →
`weekPosition`.

## 5. Weekly challenge

`GET /v1/daily` (public) adds one field:

```json
{
    "date": "2026-11-16",
    "nextResetAt": "2026-11-17T03:00:00.000Z",
    "weekly": {
        "id": 4021,
        "number": 7,
        "mode": "specs",
        "maxAttempts": 10,
        "endsAt": "2026-11-23T03:00:00.000Z",
        "result": { "status": "won", "attempts": 4 }
    },
    "puzzles": [ /* the four daily puzzles, unchanged */ ]
}
```

- `weekly` is the current week's challenge, dated on its Monday, or **null** when none exists. Do not
  render the weekly card when it is null.
- `mode` is always `specs`; `maxAttempts` 10; `endsAt` is next Monday 00:00 São Paulo.
- `result` is present only for a signed-in player who started the challenge (including
  `in_progress`), with `status` and `attempts`. It is absent for guests and for players who never
  started it.
- The challenge is played through the same `POST /v1/daily/puzzles/{id}/play`, with the daily Specs
  rules and feedback. It is dated on the Monday; it is not listed in `puzzles`, the archive, the daily
  ranking or the daily results (`kind=weekly` is required).
- Next week's challenge is not playable before Monday; its id responds **404**. Guests can play and
  import it, as with daily puzzles.

`GET /v1/daily/weekly/ranking` (session required, **401** for guests) returns the viewer and the players
they follow who finished the current challenge.

```json
{
    "weekly": {
        "id": 4021,
        "number": 7,
        "mode": "specs",
        "maxAttempts": 10,
        "endsAt": "2026-11-23T03:00:00.000Z"
    },
    "data": [
        {
            "userId": "8a7c...",
            "username": "quick",
            "avatar": null,
            "supporterBadge": true,
            "status": "won",
            "attempts": 3,
            "finishedAt": "2026-11-16T15:02:11.000Z"
        }
    ]
}
```

- **Response shape decided in implementation.** The change's specs fix the ordering and membership,
  not the envelope. The implemented envelope is `{ weekly, data }`: `weekly` is the same entry as
  `GET /v1/daily` but **without** the viewer's `result`; `data` is an unordered-by-the-client array
  whose array order **is** the ranking (position 1 is index 0). Do not send `weekly` back into the
  daily-hub model if it expects `result`.
- Content: only the viewer and followed players with a **ranked finished** result. Winners come first,
  ordered by fewer attempts then earlier `finishedAt`; losers follow (same tie-breaks). Unfinished,
  imported (never ranked) and non-finished results are absent. Only the current week's challenge.
- If there is no current challenge, `weekly` is null and `data` is empty.
- `supporterBadge` is the display badge, as in the daily ranking; it does not order the list.

## 6. Practice

### `POST /v1/daily/practice` (public)

Body: `{ "mode": "cover" }` or `{ "mode": "specs" }`. Other modes are rejected with **400**. Any visitor,
signed in or not, can start a round. The endpoint is rate limited to **30 starts per 60 seconds per
client**; past it, starts respond **429** until the window passes. If no eligible answer remains, it
responds **503** and creates no round.

Response (201), the same play state as the daily with `roundId` instead of `puzzleId`/`number`/`date`,
and without `community` or `ranking`:

```json
{
    "roundId": "0b3f2c1e-...",
    "mode": "cover",
    "maxAttempts": 6,
    "attempts": 0,
    "status": "in_progress",
    "feedback": [],
    "hints": { "imageTokens": ["..."], "keywords": [] },
    "hintAvailable": false,
    "hintAt": null
}
```

- The first image token is the pixelated image; `answer` is absent until the round finishes.
- Specs practice has no image tokens and offers the same columns and hint as the daily.

### `POST /v1/daily/practice/{id}/play` (public)

Body and semantics are identical to the daily play body: `{ "guesses": [...], "hintAt": 6 }`, with
`null` for a skip, at most 10 guesses in the body and the mode's attempt limit on the round (6 for Cover,
10 for Specs; past it responds **400**). Responses are 201 with the same practice shape. Rules:

- Progress is stored on the round and can only grow. Removing/changing stored guesses or moving the
  hint responds **400**.
- A round started while signed in is playable only by that account (**403** for another account,
  including a guest). A guest round is playable by anyone holding its id.
- Unknown or older-than-7-days rounds respond **404**, both for play and for their image tokens.
- The answer appears only when the round is won or lost. The Specs hint and its revealed column appear
  exactly as in the daily (after 5 guesses, when the hint is used).
- Practice never writes a daily result, never appears in results/archive/today, and its response never
  contains `ranking`; a practice win changes no points, streak or position.

### Images

`GET /v1/daily/images/{token}` returns `image/webp` for both puzzle and practice tokens. Practice tokens
are signed with the round as their source (the payload carries `s: "r"` and the round id instead of a
puzzle id); they are opaque, so use the `hints.imageTokens` array in order (most pixelated first) and do
not construct, parse or rewrite tokens. The route also returns 403 for a tampered token, 404 for a
missing/expired source (including a round older than 7 days) and 503 when the upstream image cannot be
fetched.

## 7. Frame-to-data map

Figma file `ikcThguwowTdynGz0L2YkS`, section `5050:13680`.

| Frame | Node | Data and reads |
| --- | --- | --- |
| Ranking · Desktop · Geral · Semana | `5050:14254` | `GET /v1/daily/ranking?period=week` (default). Podium = `data[0..2]`; table = the page; “Seu resumo” and the viewer footer = `viewer` + `pointsToTop100`; positions/medals from `position`; change arrows from `positionChange`; Premium from `supporterBadge`. |
| Ranking · Desktop · Cover · Semana | `5050:14638` | Same with `mode=cover`. Table columns wins / average attempts / best streak from `wins`, `averageAttempts`, `bestStreak`; `points` is Cover-only. |
| Ranking · Desktop · Estado vazio (Hoje) | `5050:14803` | `GET /v1/daily/ranking?period=today` (plus the mode tabs). A short or empty `data` is the empty state; `viewer` may still exist; `positionChange` is null for today. |
| Ranking · Desktop · Deslogado | `5050:15324` | `GET /v1/daily/ranking` without a session: `viewer: null`, `pointsToTop100: null`, same `data`. Show the sign-in CTA; never call `scope=following` logged out (401). |
| Ranking · Mobile · Geral · Semana | `5051:13889` | Same response as the desktop overall frame; layout only. |
| Ranking · Hub v2 com entrada de Ranking | `5051:13890` | `GET /v1/daily/ranking?period=week&limit=3` for the panel (plus `viewer`); `GET /v1/daily` for the four dailies and the `weekly` card; `POST /v1/daily/practice` from the practice cards (Cover/Specs). |
| Ranking · Resultado v2 com entrada de Ranking | `5051:14093` | `ranking` block of `POST /v1/daily/puzzles/{id}/play`: `pointsEarned`, `bonusEarned`, `previousWeekPosition` → `weekPosition`, `pointsToTop100`. |
| Ranking · Componentes / Notas | `5051:14622`, `5051:14642` | No request: rules, scoring, tie-breaks and decisions. The scoring marked PROPOSTA is adopted as implemented (section 3). |

## 8. Client responsibilities

- **Podium and placeholders.** The first three rows of `data` are the podium; when the list has fewer
  than three rows, render the design's “Vaga aberta” placeholders rather than shifting rows. Positions
  are already consecutive.
- **Premium badge.** Render it from `supporterBadge` only. Hidden badges must not show, and supporter
  status must not change any number or position.
- **Guest ranking.** The ranking page works logged out with `viewer: null`; show the sign-in CTA. Do
  not infer “the viewer has no result” from an absent row — fetch with a session for that.
- **“Seu resumo”.** Build it from `viewer` (position, points, win rate, mode points or mode stats) and
  `pointsToTop100`; show the gap only when it is non-null.
- **Caching.** Ranking reads are not cached on the server, so a refresh returns the current list. Still
  do not poll on a short fixed timer: refresh when the screen opens or on a user action, and invalidate
  any client-side ranking cache after the viewer's own finish (or rely on the play response's fresh
  `weekPosition`).
- **Position change.** `positionChange > 0` is up, `< 0` is down, `0` is unchanged, `"new"` is the new
  badge, `null` (today, or before the day's snapshot is ready) renders nothing.
- **Results screen.** Use only the play response's `ranking` block; request a fresh ranking read if the
  screen needs the leaderboard itself. A reopened finished puzzle returns the same points and bonus; its
  week fields reflect the current week.
- **Weekly entry point.** Render the weekly card only when `weekly` is non-null; use `endsAt` for the
  countdown; after playing, `GET /v1/daily` refreshes `weekly.result`. The friends ranking comes from
  `GET /v1/daily/weekly/ranking`; positions are the array order.
- **Practice entry point.** Start a round before navigating, keep `roundId` for the play calls and for
  resuming the screen; guest rounds must be resumed from the id. Handle 429 by waiting out the window
  and 503 as “unavailable, try again”.
- **Weekly vs daily.** Weekly finishes and practice never show a “+N pts” ranking card; use the daily
  result screen card only when `ranking` is present.

## 9. Known caveats and limitations

1. **Historical imports were backfilled as counted.** The migration counts every existing result
   finished on the puzzle's São Paulo date, and the data cannot distinguish a result created by the
   import endpoint from one finished through play. At launch those imported results count, while every
   import after deploy never counts. The ranking/streak history can therefore include some guest plays
   imported historically; this is accepted for launch.
2. **Freshness.** Finishes are visible on the next ranking read; bans and suspensions take effect within
   60 s because the server caches the locked-id list for that long. `positionChange` compares with the
   snapshot of the same period without today's puzzles: it is `null` until that snapshot is ready
   (right after midnight, or after a boot), `"new"` when the player was not in it, and always `null` for
   `period=today`. This is the design's accepted trade-off, not a bug.
3. **Weekly ranking envelope.** `GET /v1/daily/weekly/ranking` was specified by behavior only; its
   `{ weekly, data }` envelope and its array-order positions are **decided in implementation** (section
   5). The `weekly` object there has no viewer `result`.
4. **Overall `modePoints` and the bonus.** `modePoints` breaks down the four modes; the shared
   completion bonus is included only in `points`. The four mode values can therefore sum to less than
   `points` on a day with the bonus. Do not show `modePoints` as a strict decomposition.
5. **No ranking history.** The server keeps no past rankings beyond the “without today” list used for
   `positionChange`; there are no archived seasons, medals or monthly resets.
6. **Practice rounds are capability ids.** Guest rounds are playable by anyone with the id; the id is a
   random UUID and has no value outside practice. Do not put it in share links.
7. **No server-rendered images.** Podium/avatar medals and the result card are client-rendered; the
   server only returns data and the WebP image tokens.

## 10. Scope reminder

This document fixes only the server contract for `add-daily-ranking-and-challenges`. Building the
ranking page, hub panel, result card, weekly challenge and practice screens, their copy and their
client-side caches is a separate change in `game-node-clients`.
