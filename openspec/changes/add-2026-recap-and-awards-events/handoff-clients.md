# 2026 Recap and Awards — client hand-off

Server contract for the 2026 "Eventos 2026 · Retrospectiva + Awards" design. Client UI, share-image
rendering, the Dock "new" badge and the stories are client work in `game-node-clients`; this
document only fixes the HTTP contract and maps each named surface to the data it reads.

Regenerate the client from `server_swagger.json`. All routes are under `/v1` and use the normal
Better Auth session (cookie or `Authorization: Bearer <token>`). A protected call without a session
returns 401. Public routes never return 401 and treat a missing session as anonymous.

The server does not return full game objects from any new endpoint: game data is ids only. Hydrate
the ids with the existing public game repository reads (`POST /v1/game/repository` with
`{ "gameIds": [...], "relations": { "cover": true } }`, or `POST /v1/game/repository/{id}`) and
cache them per screen. Ratings stay on the server's 0–5 scale; clients convert them to the design's
0–10 scale (see "Scale conversion" below).

## Design source

This document was written against the current implementation and is reconciled with the Figma frame
appendix [figma-frames.md](./figma-frames.md). The design file is `ikcThguwowTdynGz0L2YkS`, canvas
`5407:677` ("Eventos 2026 · Retrospectiva + Awards"). The appendix lists all 26 top-level frames, the
10 product screens and the five story frames, and maps each screen, section and entry surface to the
reads below. Remaining mismatches are recorded there under "Real gaps"; they are client work or
documented limitations, not pending API work.

Implementation status of the server:

| Area | Status |
| --- | --- |
| Awards calendar, `phase`, `GET /v1/awards/events/current` | Implemented |
| Community nominations and nominee finalization | Implemented |
| Ballot, shared ballot, vote restriction, completion metric | Implemented |
| Results read/write, played-only fields | Implemented |
| Lifecycle tick, results on/after `resultsDate` | Implemented (hourly tick) |
| Scoreboard endpoint | Implemented |
| Recap window, status, read, derivations, goals | Implemented |
| Recap and goal notifications | Implemented |
| Awards milestone fan-out | Implemented, including the goal-campaign resume |

The response shapes and status codes below were read from the code and are covered by the affected
test suites.

## Conventions

- **Dates and day boundaries.** Dates are ISO 8601 strings. The Awards calendar and every Recap day
  boundary are UTC instants. Do not apply the viewer's timezone to the daily playtime array, streak,
  weekday or goal year.
- **2026 phases are data.** The date shown in the design (nominations 3–16 Nov, Recap 15 Nov) is an
  example; the 2026 event and the Recap opening are edited by admins without a deploy. Read the
  dates, never hard-code them.
- **Awards and Recap are separate.** They share the notification infrastructure only. There is no
  combined endpoint, entity or phase. A Recap link to the ballot is a client composition of two
  reads (`GET /v1/recap/...` and `GET /v1/awards/...`).
- **`isVotable` is not the phase.** The categories read keeps its legacy event-level `isVotable`
  boolean (true strictly between voting start and end, second precision). Use the event `phase` for
  screen state and `isVotable` only if an old screen still needs it.
- **Base timestamps.** Entities that extend the server's base entity also return `createdAt`,
  `updatedAt` and `deletedAt` (normally null). Tables below list the meaningful fields and omit those
  three for brevity.

## Endpoint index

| Method | Path | Auth | Used by |
| --- | --- | --- | --- |
| GET | `/v1/awards/events` | public | Event discovery; the design's Home has no pre-first-phase card |
| GET | `/v1/awards/events/current` | public | Home Awards card, Dock, current-event context |
| GET | `/v1/awards/events/:id` | public | Event detail after navigation |
| GET | `/v1/awards/events/year/:year` | public | Event by year |
| GET | `/v1/awards/:eventId/categories` | public | Nominees, event detail, ballot fallback |
| GET | `/v1/awards/:eventId/results` | public | Results screen |
| GET | `/v1/awards/:eventId/ballot` | session | Ballot web and mobile |
| GET | `/v1/awards/:eventId/votes/:userId` | public | Shared ballot link (logged out) |
| GET | `/v1/awards/:eventId/nominations/me` | session | Nominations screen |
| PUT | `/v1/awards/:eventId/nominations/:categoryId` | session | Nominations save/clear |
| POST | `/v1/awards/vote` | session | Ballot vote |
| GET | `/v1/awards/vote/:eventId/recent` | public | Existing recent-votes list (not required by the new screens) |
| GET | `/v1/awards/vote/:userId/:categoryId` | public | Existing single-vote lookup (not required by the new screens) |
| GET | `/v1/awards/:eventId/scoreboard/:userId` | public | Scoreboard |
| GET | `/v1/recap/current` | public | Home Recap card, Dock |
| GET | `/v1/recap/:year/:userId/status` | public | Recap card and gate before the read |
| GET | `/v1/recap/:year/:userId` | public | Recap web and all five stories |
| GET | `/v1/recap/goals/:year` | session | Goal section/story |
| PUT | `/v1/recap/goals/:year` | session | Goal save |
| GET | `/v1/notifications` | session | Inbox, Dock unread count |
| PATCH | `/v1/notifications/read` | session | Inbox read |
| PATCH | `/v1/notifications/read-all` | session | Inbox mark all read |
| POST | `/v1/awards/admin/event` | admin | Operations only |
| POST | `/v1/awards/admin/category` | admin | Operations only |
| POST/DELETE | `/v1/awards/admin/category/suggestion` | admin | Operations only |
| PUT | `/v1/recap/admin/editions/:year` | admin | Operations only |

## Home

### Awards card by phase

Source: `GET /v1/awards/events/current`. It is public and returns the latest event **by year** whose
first phase has started.

```json
{
    "id": 12,
    "year": 2026,
    "votingStartDate": "2026-12-01T00:00:00.000Z",
    "votingEndDate": "2026-12-20T23:59:59.000Z",
    "resultsDate": "2026-12-27T00:00:00.000Z",
    "nominationStartDate": "2026-11-20T00:00:00.000Z",
    "nominationEndDate": "2026-11-28T23:59:59.000Z",
    "eligibilityCutoffDate": "2026-11-30T00:00:00.000Z",
    "phase": "nominations",
    "categoriesCount": 12,
    "createdAt": "2026-10-01T12:00:00.000Z",
    "updatedAt": "2026-11-15T12:00:00.000Z",
    "deletedAt": null
}
```

`phase` is one of `upcoming`, `nominations`, `nominations_closed`, `voting`, `voting_closed`,
`results`. An event without both nomination dates never reports `nominations` or
`nominations_closed`; it goes from `upcoming` to `voting` to `voting_closed` to `results`.

| `phase` | Design Home card | Data and CTA |
| --- | --- | --- |
| `upcoming` | No card: the design has no state before the first phase | Dates from the event; no write CTA. Nominations only exist when both nomination dates are set. `current` does not return it. |
| `nominations` | Awards · Indicações | CTA to nominations. Read `GET .../nominations/me`; save with `PUT .../nominations/:categoryId`. Labels game names via the game repository. |
| `nominations_closed` | No card: dead period 17–30 Nov | Read `GET .../categories` when another surface needs the nominees; no write CTA. |
| `voting` | Awards · Votação | CTA to the ballot. `GET .../ballot` for progress and played nominees. |
| `voting_closed` | No card: dead period 21–26 Dec | Read the ballot to show the user's choices; `POST /vote` is rejected. Results may still be empty. |
| `results` | Awards · Resultado through 27 Jan | `GET .../results` and `GET .../scoreboard/:userId`; both are public. After 27 Jan the design has no event card. |

Rules the card must respect:

- Show the Awards card only while there is something to do. For the 2026 design, render no Awards
  card in `upcoming`, `nominations_closed`, `voting_closed`, or after 27 Jan (appendix,
  [Home event cards](./figma-frames.md#home-event-cards-by-phase-and-dead-periods)).
- A complete ballot removes the Awards card from the top and it returns in the results phase; decide
  it in the client from `BALLOT.categoriesVoted === BALLOT.categoriesTotal` (the event read has no
  completion field; appendix gap G8).
- `GET events/current` returns 404 when no event has started. A future event is **not** returned by
  `current`; read `GET /v1/awards/events` (or `GET /v1/awards/events/year/:year`) only for a
  non-design surface that needs a future event. Once an event has started, `current` keeps returning
  it even after `results` (for example, the 2026 event on 10 Jan 2027).
- A 2027 event whose nominations start later does not replace the 2026 event in `current`.
- `categoriesCount` is the number of categories of the current event; it is not returned by the
  other event reads.
- `eligibilityCutoffDate` is optional and is a release cutoff for the event, not a UI deadline.

### Recap card by phase

Two public reads:

- `GET /v1/recap/current` returns the current Recap window:
  `{ "year": 2026, "opensAt": "...", "closesAt": "...", "phase": "live" }`.
  - Before the current year opens, it returns the **previous** year with phase `closed`.
  - On or after `opensAt`, it returns the current year with phase `live`.
  - After 31 December, it returns the closed year with phase `closed`.
  - It never returns `upcoming`: an upcoming year is observed through the status read below.
- `GET /v1/recap/:year/:userId/status` returns
  `{ "isRecapCreated": true, "isRecapEligible": true, "phase": "live" }` for a user and year. It is
  public so a logged-out visitor can check a shared Recap, but it needs a `userId`.

| Recap phase | Card state | Data |
| --- | --- | --- |
| `upcoming` | No card: the design shows the Recap card from its opening only | `status.phase` for the requested year. A future year's opening date is not public (design 9b); do not render "opens on …" from the API alone. |
| `live` | "Your Recap is here" / "updates daily" | `status.isRecapCreated`; read `GET /v1/recap/:year/:userId` when created. |
| `closed` | "Your year closed" | Read the Recap; `isFinal` says whether it is the final version. |

- If `isRecapEligible` is false, do not show a generation CTA.
- If `isRecapCreated` is false, show the generation/wait state and do not call the Recap read; a
  missing Recap is not a 200 response.
- The Recap read is cached server-side for 15 minutes; a regeneration clears its cache key. The
  daily generation runs at 04:00 UTC. Invalidate any client-side Recap query after a generation or a
  known write.

## Dock

There is no Dock endpoint and no server-side Dock state. The Dock is client-local; the proposal
explicitly leaves the "new" badge state to the client.

| Dock data | Source |
| --- | --- |
| Awards entry visible and its phase | `GET /v1/awards/events/current` (200); label from `phase` |
| Recap entry and its phase | `GET /v1/recap/current` (`live`/`closed`); use the status read for a specific year |
| Unread badge | `GET /v1/notifications?filter=unread&limit=1` → `unreadCount`; hide for logged-out users |
| "New" badge | Client-local (not in the API) |

Do not add a Dock refresh loop for the badge: the unread count is already part of the inbox response
and can be refreshed with the existing notification polling/query invalidation. The Dock must not
show a personalized entry (Recap, notifications) to a logged-out visitor; the public Awards entry
may remain visible.

The 2026 design recommends option A (`5440:1294`): "Awards 2026" under "Descobrir" with an "Ao vivo"
badge in nominations/voting and "Novo" in results, and "Retrospectiva" in place of Wrapped with a
"Nova" badge until the first visit. Both badges are client-local; the season runs from the first
phase through 27 Jan, after which the Dock is normal and Wrapped returns. The full option table with
node ids is in the appendix ([Dock](./figma-frames.md#dock)).

## Recap web

Source: `GET /v1/recap/:year/:userId` (public). A logged-out visitor can read a shared Recap. The
response is the persisted Recap plus fields derived on read. The Recap payload is one call; the hero
name/avatar comes from the existing profile read, the goal section reads
`GET /v1/recap/goals/:year` (session), and the owner's footer sources come from the existing
connections read.

Top-level fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | number | Recap row id. It changes on regeneration; do not use it as a route key. |
| `year` | number | Recap year. |
| `profileUserId` | string | Owner of the Recap. Use `GET /v1/profile/:id` for name/avatar. |
| `totalPlayedGames` | number | Number of rows in `playedGames`, not necessarily distinct games (the grouping is game × source × platform). Use `topGames.length` for distinct games. |
| `totalPlaytimeSeconds` | number | Total playtime in the year. |
| `totalAddedGames` | number | Games added to the library in the year. |
| `totalFinishedGames` | number | Finished in the year. |
| `totalDroppedGames` | number | Dropped in the year. |
| `isFinal` | boolean | Final Recap of a closed year; never regenerated. |
| `dailyPlaytimeSeconds` | number[] \| null | One entry per UTC day of the year, January first; `null` for a Recap generated before this feature. |
| `communityHighlights` | object \| null | Stored at generation; `{ minority, inTune }`, each an object or `null`. `null` for an old Recap. |
| `totalReviewsCreated` | number | Reviews created in the year. |
| `totalCollectionsCreated` | number | Collections created in the year. |
| `totalFollowersGained` | number | Followers gained in the year. |
| `totalLikesPerformed` | number | Likes performed in the year. |
| `likesHistoryComplete` | boolean | Whether the like history is complete. |
| `likesCompleteSince` | string \| null | Start of complete like history, when applicable. |
| `playedGames` | array | Per game/source/platform rows; see below. |
| `playedGamesByPlatform` | array | `GamePlatform` fields plus `count`. Derived from `playedGames`. |
| `distributionByGenre` | array | `{ criteriaId, criteriaName, count, finishedCount }`. |
| `distributionByMode` | array | Same item shape. |
| `distributionByTheme` | array | Same item shape. |
| `distributionByPlatform` | array | Same item shape. |
| `backlogGrowth` | number | `max(0, totalAddedGames - totalFinishedGames - totalDroppedGames)`. |
| `calendar` | object \| null | Derived from `dailyPlaytimeSeconds`; `null` for an old Recap. |
| `topGames` | array | Played games aggregated per game, ordered by playtime desc, then game id asc. |
| `playtimeByPlatform` | array | `{ platform, totalPlaytimeSeconds, share }`, ordered by playtime. |

The response also contains the raw `genres`, `themes`, `modes` and `platforms` relation rows because
the entity is returned. Prefer the `distributionBy*` arrays; the raw rows are not part of the
contract these screens should depend on.

`playedGames[]`:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | number | Row id. |
| `recapId` | number | Parent Recap id. |
| `gameId` | number | Game id; hydrate with the game repository. |
| `platformId` | number | Platform id. |
| `totalPlaytimeSeconds` | number | Playtime for this game/source/platform in the year. |
| `percentOfTotalPlaytime` | number | 0–1 fraction rounded to 4 decimals (the name is historical, not a percentage). |
| `percentOfTotalPlaytimeFormatted` | string | The same value as a percentage string, e.g. `"25.08"`. |
| `firstPlayedAt` | `YYYY-MM-DD` \| null | First day with playtime above zero in the year; falls back to the library start date. |
| `finishedAt` | ISO datetime \| null | Finish date when it falls inside the year. |
| `rating` | number \| null | The user's rating, 0–5. |
| `platform` | object | `GamePlatform` with `id`, `name`, `abbreviation`, `alternative_name`, `category`, `generation`, `checksum`, `createdAt`, `updatedAt`, and the derived `iconName`. |

A game can appear more than once in `playedGames` when it has playtime on more than one source or
platform. `topGames` merges those rows:

| Field | Type | Meaning |
| --- | --- | --- |
| `gameId` | number | Game id. |
| `platformIds` | number[] | Distinct platforms played on. |
| `totalPlaytimeSeconds` | number | Sum of all rows for the game. |
| `share` | number | 0–1 share of the year's total playtime, rounded to 4 decimals. |
| `firstPlayedAt` | `YYYY-MM-DD` \| null | Earliest first-played day across the rows. |
| `finishedAt` | ISO datetime \| null | Earliest finish date across the rows. |
| `rating` | number \| null | The user's rating, 0–5. |

`calendar`:

| Field | Type | Meaning |
| --- | --- | --- |
| `monthlyPlaytimeSeconds` | number[12] | January first. |
| `topMonth` | `{ month: 1–12, playtimeSeconds }` \| null | Null when the year has no playtime. Ties keep the earlier month. |
| `longestStreak` | `{ start, end, days }` \| null | UTC days with playtime above zero; `start`/`end` are `YYYY-MM-DD`. |
| `topWeekday` | `{ weekday: 0–6, share }` \| null | 0 = Sunday (UTC); `share` 0–1. Ties keep the earlier weekday. |
| `weekendShare` | number | 0–1, Saturday and Sunday. |

`communityHighlights`:

| Field | Type | Meaning |
| --- | --- | --- |
| `minority` | highlight \| null | Largest gap between the user's rating and the community average. |
| `inTune` | highlight \| null | Smallest gap; absent when only one game qualifies and it is a minority opinion. |

A highlight is `{ gameId, userRating, communityAverage, reviewCount, beyondShare, sameRangeCount }`.
`beyondShare` is the share of other reviewers at or beyond the user's rating in the direction away
from the average (0–1). `sameRangeCount` is the number of other reviewers within ±0.5 of the user's
rating. Both highlights are null when no played and rated game has at least 20 other reviews.

Section map:

| Recap web section | Fields | Notes |
| --- | --- | --- |
| Hero / year summary | `year`, `profileUserId`, `isFinal`, timestamps; profile read for name/avatar | A final Recap is a closed year. |
| Totals | `totalPlayedGames`, `totalPlaytimeSeconds`, `totalAddedGames`, `totalFinishedGames`, `totalDroppedGames`, `backlogGrowth` | `totalPlayedGames` is row count; see note above. |
| Calendar / monthly | `calendar.*`, `dailyPlaytimeSeconds` | If `calendar` is null, hide the calendar ("no calendar" for old Recaps); do not derive it client-side. |
| Top games | `topGames[]` | Ids only; hydrate covers and names in one batched game repository call. |
| Played games list | `playedGames[]` | Use when the design shows per-platform rows, first play, finish date or rating. |
| Platforms | `playtimeByPlatform[]`, `playedGamesByPlatform[]`, `distributionByPlatform[]` | The first two measure playtime; the distribution measures library counts. Do not mix them. |
| Genres / modes / themes | `distributionByGenre`, `distributionByMode`, `distributionByTheme` | Counts of library items, not hours. |
| Community | `communityHighlights` | Null-safe; an old Recap can have `null`. |
| Activity | `totalReviewsCreated`, `totalCollectionsCreated`, `totalFollowersGained`, `totalLikesPerformed`, `likesHistoryComplete`, `likesCompleteSince` | Likes are shown only when `likesHistoryComplete` allows it. |
| Goal | `GET /v1/recap/goals/:year` | Authenticated; see [Goals](#goals). |
| Footer / share | No Recap field for the connected sources; use the existing connections read for the owner | The Recap read is public; a logged-out shared Recap cannot list providers. The client renders and shares the page/image; the server does not render share images. |

### The five stories

Every story reads the same public `GET /v1/recap/:year/:userId` response; there is no story-specific
endpoint and no server-side image. The design order and frames (appendix,
[The five stories](./figma-frames.md#the-five-stories)):

| # | Story | Figma node | Fields |
| --- | --- | --- | --- |
| 1 | Abertura — 412 horas | `5413:862` | `totalPlaytimeSeconds`, `topGames.length`, `totalFinishedGames`, `calendar.monthlyPlaytimeSeconds`, `topGames[0..3]` |
| 2 | Jogo do ano | `5413:917` | `topGames[0]`: `gameId`, `totalPlaytimeSeconds`, `share`, `finishedAt`, `rating` |
| 3 | Março — calendário | `5414:911` | `calendar.topMonth`, `calendar.longestStreak`, `calendar.topWeekday`, `calendar.weekendShare`, March slice of `dailyPlaytimeSeconds` |
| 4 | Opinião minoritária | `5413:945` | `communityHighlights.minority` and `.inTune`: `gameId`, `userRating`, `communityAverage`, `reviewCount`, `beyondShare`, `sameRangeCount` |
| 5 | Card final — seu ano em um card | `5413:983` | `profileUserId`, `totalPlaytimeSeconds`, `topGames.length`, `totalFinishedGames`, `calendar.topMonth`, `topGames[0]`; `BALLOT` + `CATEGORIES` for the GOTY count |

Use `topGames.length` for "38 jogos" (distinct games); `totalPlayedGames` counts game × source ×
platform rows. Story 5 is the only one with an Awards CTA and a GOTY composition, and that CTA is
actionable only in the `voting` phase.

## Awards event and nominations

Event reads (`GET /v1/awards/events`, `/events/current`, `/events/:id`, `/events/year/:year`) all
return the event fields shown in [Awards card by phase](#awards-card-by-phase) plus `phase`.
`events/current` additionally returns `categoriesCount`; it is the only read that returns it.

### Categories and nominees

`GET /v1/awards/:eventId/categories` (public) returns the categories in `order` ascending:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | number | Category id. |
| `eventId` | number | Event id. |
| `name` | string | Category name. |
| `description` | string | Category description. |
| `order` | number | Display order. |
| `isGOTY` | boolean | The global GOTY category. |
| `isPersonalGOTY` | boolean | The user's personal GOTY category; never accepts nominations. |
| `nomineeCount` | number | Finalization target (default 6). |
| `nomineesFinalizedAt` | ISO datetime \| null | Set once finalization ran. |
| `suggestions` | array | The nominees: `{ id, gameId, categoryId, createdAt, updatedAt, deletedAt }`. The suggestions read is not ordered; the ballot sorts nominee ids. |
| `isVotable` | boolean | Legacy event-level flag; see the convention above. |
| `votingStartDate` | ISO datetime | Copied from the event. |
| `votingEndDate` | ISO datetime | Copied from the event. |

`isPersonalGOTY` and `isGOTY` categories are created automatically with an event, initially at order
0 and 1. Admins create the other categories and can change any category's `order`; the read always
sorts by it.

### Nominations

`GET /v1/awards/:eventId/nominations/me` (session) returns every non-personal-GOTY category in
`order`, including categories with no nominations:

```json
[
    { "categoryId": 41, "gameIds": [101, 102, 103] },
    { "categoryId": 42, "gameIds": [] }
]
```

`PUT /v1/awards/:eventId/nominations/:categoryId` (session) replaces the user's nominations for one
category. Body:

```json
{ "gameIds": [101, 102] }
```

- 0 to 3 distinct ids; an empty array clears the category.
- 200 with an empty body on success.
- 400 when there are more than 3 ids, duplicate ids, an unknown game, an ineligible game, the
  category is personal GOTY, the event is outside the `nominations` phase, or the category does not
  belong to the event.
- 404 when the event does not exist.
- 401 without a session.

Eligibility is the event year plus the optional cutoff: a game released in the event year and, when
`eligibilityCutoffDate` is set, on or before that day. A game with no release date is eligible.

The nominations screen shows the user's current picks from the GET, the category list from the
categories read, and a game picker. There is no dedicated candidate-search endpoint: use the
existing game search/repository and filter by the event year and cutoff; the server validates every
id and rejects ineligible games. The 3-game limit is a server rule; do not rely only on the client
counter.

## Ballot

### Ballot read (web and mobile)

`GET /v1/awards/:eventId/ballot` (session) returns the whole ballot in one call. Web and mobile use
the same shape; there is no separate mobile endpoint or summary variant.

```json
{
    "eventId": 12,
    "year": 2026,
    "phase": "voting",
    "categoriesVoted": 7,
    "categoriesTotal": 12,
    "categories": [
        {
            "id": 40,
            "name": "Your Game of the Year",
            "description": "Your personal GOTY...",
            "order": 0,
            "isPersonalGOTY": true,
            "voteGameId": null,
            "playedNomineesCount": 4,
            "nominees": [
                {
                    "gameId": 101,
                    "status": "played",
                    "playtimeSeconds": 309600,
                    "rating": 4.5
                },
                {
                    "gameId": 102,
                    "status": "planned",
                    "playtimeSeconds": 0,
                    "rating": null
                },
                {
                    "gameId": 103,
                    "status": "not_played",
                    "playtimeSeconds": 0,
                    "rating": null
                }
            ],
            "suggestedGameId": 101
        }
    ]
}
```

- `categories` is in `order` ascending and includes the personal-GOTY category.
- The ballot payload has no `isGOTY` field. Identify the global GOTY category from
  `GET /v1/awards/:eventId/categories` by matching its `isGOTY` flag on the category id — two reads,
  `BALLOT` + `CATEGORIES`. The server sorts both reads by `order`, which admins configure (the
  auto-created special categories included); do not infer the kind or the position from the English
  names or from the initial order 0/1.
- `nominees` are the category's `suggestions`, sorted by `gameId` ascending. A category with no
  nominees returns an empty array; this is also what a legacy event looks like.
- `status` is `played`, `planned` or `not_played`:
  - `played`: playtime above zero, or a library entry with status playing/finished/dropped, or a
    started or finished date. A finished game with no playtime source is `played` with
    `playtimeSeconds: 0`.
  - `planned`: a library entry with no play condition ("Na sua lista de desejos"). There is no
    separate wishlist entity; this is the design's wishlist label.
  - `not_played`: no playtime, library entry, dates or review.
- `playtimeSeconds` is total recorded playtime for the user and game, all sources and platforms.
- `rating` is the user's review rating, 0–5, or null. Convert for display with "Scale conversion"
  below.
- `categoriesVoted` counts categories with a vote; `categoriesTotal` is the number of categories.
- `playedNomineesCount` counts nominees with `status: "played"`.
- `suggestedGameId` is non-null only on the personal-GOTY category. It is the eligible game the user
  played in the event year with the highest rating, ties broken by playtime in the year; null when
  none exists. It is a suggestion, not a vote; `voteGameId` remains null until the user votes.
- 401 without a session. 404 for an unknown event.

### Vote

`POST /v1/awards/vote` (session), body `{ "categoryId": 41, "gameId": 101 }`, returns 201 with an
empty body. A repeated vote in the same category replaces the previous one.

| Condition | Result |
| --- | --- |
| `phase` is `upcoming`, `nominations` or `nominations_closed` | 400, voting has not started |
| `phase` is `voting_closed` or `results` | 400, voting has ended |
| Game released outside the event year, or after the cutoff | 400 |
| Event has both nomination dates, category is not personal GOTY, game is not one of its nominees | 400 |
| Personal GOTY in a nominations event | Accepted for any eligible game |
| Event without both nomination dates | Legacy rules: any eligible game |
| No session | 401 |

The vote restriction is the only behavior change for existing events, and it applies only to events
with both nomination dates. For a 2026 category, the picker must offer the category's nominees (from
the ballot or categories read); it must not offer free search results. Personal GOTY keeps free
search among eligible games.

An accepted vote triggers achievement evaluation for `awards_participation` and
`awards_ballot_completed`. The admin definition's `year` filter decides which event's progress is
measured; the "Awards 2026" definition decides the XP and medal, and the server does not seed it.

### Shared ballot (logged out)

`GET /v1/awards/:eventId/votes/:userId` (public) returns the user's votes as category/game pairs,
ordered by category order:

```json
[
    { "categoryId": 40, "gameId": 101 },
    { "categoryId": 41, "gameId": 207 }
]
```

- A user with no votes returns `[]`.
- An unknown event returns 404.
- The shared page also reads `GET /v1/awards/:eventId/categories` for names and nominees and hydrates
  game ids with the public game repository. No session is needed on any of those calls.

## Results

`GET /v1/awards/:eventId/results` (public) returns an array; before results are computed it is `[]`.
After computation it has one item per category, ordered by category id ascending. The numbers below
are illustrative; the read shape is the current code:

```json
[
    {
        "id": 7001,
        "totalVotesCount": 1000,
        "totalUniqueGamesSubmitted": 9,
        "totalUsersParticipating": 812,
        "totalPlayedVotesCount": 600,
        "categoryId": 42,
        "category": {
            "id": 42,
            "eventId": 12,
            "name": "Narrativa",
            "description": "...",
            "order": 2,
            "isGOTY": false,
            "isPersonalGOTY": false,
            "nomineeCount": 6,
            "nomineesFinalizedAt": "2026-11-29T00:00:00.000Z"
        },
        "winners": [
            {
                "id": 9001,
                "resultId": 7001,
                "gameId": 101,
                "position": 1,
                "totalVotes": 400,
                "votesPercentage": 0.4,
                "playedVotes": 174,
                "playedVotesPercentage": 0.29
            }
        ]
    }
]
```

| Field | Meaning |
| --- | --- |
| `totalVotesCount` | Votes in the category. |
| `totalUniqueGamesSubmitted` | Distinct games voted for. |
| `totalUsersParticipating` | Distinct voters. |
| `totalPlayedVotesCount` | Votes cast by users who had played the game they voted for. |
| `winners[].position` | 1 is the winner. The processor keeps up to the top 10 voted games. |
| `winners[].totalVotes` | Votes for that game. |
| `winners[].votesPercentage` | Share of the category's total votes, 0–1. |
| `winners[].playedVotes` | Votes for that game from voters who had played it. |
| `winners[].playedVotesPercentage` | Share of the category's played-only votes, 0–1. |

The category relation is returned without its `suggestions`; use the categories read if the screen
needs nominee data. The processor computes the played-only counts and the tie-break ranking on the
first hourly tick at or after `resultsDate`, in one transaction per event; the unique index
`awards_category_result(categoryId)` makes a concurrent second run lose and roll back. A second run
finds results through `eventHasResults` and does nothing. Results are a snapshot: a vote or a new
play session after computation does not change them.

### Scoreboard

`GET /v1/awards/:eventId/scoreboard/:userId` (public) returns the user's score once results exist:

```json
{
    "totals": { "hits": 7, "voted": 8, "scorable": 11 },
    "categories": [
        {
            "categoryId": 42,
            "votedGameId": 101,
            "winningGameId": 101,
            "outcome": "hit"
        },
        {
            "categoryId": 43,
            "votedGameId": null,
            "winningGameId": 207,
            "outcome": "not_voted"
        }
    ],
    "personalGOTY": { "gameId": 103, "otherUsersCount": 312 }
}
```

- `categories` has one item per non-personal-GOTY category that has a result. The example shows two
  of the 11 categories. The order follows the results read (category id ascending), not the category
  `order`; use the categories read if the screen must display the design order.
- `votedGameId` is null when the user did not vote in that category.
- `winningGameId` is the position-1 winner, or null if the result has no winner row.
- `outcome` is `hit` (vote equals the winner), `miss` (voted for another game) or `not_voted`.
- `totals.hits` counts hits, `totals.voted` counts categories with a vote, and `totals.scorable` is
  the number of non-personal categories with results.
- `personalGOTY` is null when the user did not vote in that category; otherwise `gameId` is the
  user's pick and `otherUsersCount` counts other users who chose the same game (the user is
  excluded). It does not affect `totals`.
- 200 with the shape above. 404 before any result exists (the implementation also returns 404 for an
  unknown event, because it has no results). No session is needed.

## Notifications

Inbox read: `GET /v1/notifications` (session) with optional `cursor`, `limit` (1–100, default 20) and
`filter` (`all` or `unread`). Response:

```json
{
    "data": [
        {
            "id": 501,
            "type": "awards.milestone",
            "actors": [],
            "preview": { "text": "Awards voting is open.", "milestone": "voting_open" },
            "target": {
                "type": "awards",
                "eventId": 12,
                "year": 2026,
                "phase": "voting"
            },
            "eventCount": 1,
            "actorCount": 0,
            "lastEventAt": "2026-12-01T00:03:00.000Z",
            "version": 1,
            "readVersion": 0
        }
    ],
    "pagination": { "nextCursor": null, "hasMore": false },
    "unreadCount": 1
}
```

New types are `awards.milestone`, `recap.milestone` and `goal.reminder`. All are system
notifications: `actors` is empty, `actorCount` is 0, and no avatar/name lookup is needed. The target
already contains everything needed to navigate; the inbox needs no extra request per item. The new
types use the existing inbox grouping, pagination and read-state behavior; they add no new section,
tab or endpoint.

| Type | Preview | Target |
| --- | --- | --- |
| `awards.milestone` | `{ "text": "...", "milestone": "<milestone>" }`; one of the five fixed texts below | `{ "type": "awards", "eventId", "year", "phase" }` |
| `recap.milestone` | `{ "text": "Your year recap is here."/"Your year recap is final.", "milestone": "available"\|"closed" }` | `{ "type": "recap", "userId", "year" }` (`userId` is the recipient) |
| `goal.reminder` | `{ "text": "Your 2027 goal: 7 of 18 games finished.", "target": 18, "finished": 7 }` | `{ "type": "goal", "year" }` |

`awards.milestone` and `recap.milestone` previews carry `milestone` (the payload identifier), so clients pick their copy without matching the English `text`.

Awards preview texts and announced phases:

| Milestone | Preview text | `target.phase` | Trigger (UTC) | Recipients |
| --- | --- | --- | --- | --- |
| `nominations_open` | Awards nominations are open. | `nominations` | `nominationStartDate` | Everyone not banned or suspended |
| `nominations_close_reminder` | Awards nominations close tomorrow. | `nominations` | `nominationEndDate - 24h` | Users with no nomination in the event |
| `voting_open` | Awards voting is open. | `voting` | `votingStartDate` | Everyone not banned or suspended |
| `voting_close_reminder` | Awards voting closes in 2 days. | `voting` | `votingEndDate - 48h` | Users whose ballot is incomplete |
| `results_published` | Awards results are out. | `results` | Once results exist | Everyone not banned or suspended |

Delivery rules:

- A milestone is due at its trigger time and is skipped when stale: the phase it announces has
  ended (or, for a reminder, its deadline passed). The tick is hourly, so a time-triggered milestone
  can be delivered up to about 59 minutes late; `results_published` additionally waits for results
  to exist.
- Fan-out is batched (1000 recipients per batch, at most 20 batches per tick, i.e. at most 20k
  recipients), resumable from a stored cursor, and produces one intent per recipient. A campaign can
  take several ticks; do not expect every recipient at the exact trigger minute. The hourly Awards
  tick resumes a pending goal campaign even when no Awards event is active, so the July campaign is
  not stranded after one tick. Campaign keys are `awards:<year>:<milestone>` and `goal:<year>:july`.
- Banned and suspended users are excluded. The nominations reminder skips users who nominated; the
  voting reminder skips users with a complete ballot.
- The milestone event types, projector, campaign service and the tick that triggers them are
  implemented in the current code.
- Recap `available` is appended when a user's first Recap row is created with played or added games;
  `closed` when a Recap with data is marked final. A final Recap is never regenerated and does not
  notify twice. Current behavior does not send `available` for a Recap that was first created empty
  and only later gained data; see the gap list.
- The goal reminder runs at 12:00 UTC on 1 July (`0 12 1 7 *`) and creates the campaign
  `goal:<year>:july`. Its recipients are users with a goal for that year. A rerun sends no duplicate;
  a partial fan-out resumes on later ticks.

Read state: `PATCH /v1/notifications/read` with
`{ "items": [{ "id": 501, "version": 1 }] }` (up to 100) and
`PATCH /v1/notifications/read-all` with an optional `{ "before": "<ISO>" }`. The latter returns
`{ "success": true, "unreadCount": <remaining> }`. Both require a session.

## Goals

`GET /v1/recap/goals/:year` (session) returns the user's goal and progress:

```json
{ "year": 2027, "target": 18, "finished": 5 }
```

`target` is null when the user has no goal, and `finished` is still returned. `finished` counts
`collection_entry.finishedAt` inside the UTC year.

`PUT /v1/recap/goals/:year` (session), body `{ "target": 18 }`, returns the same shape after
upserting. `target` is an integer from 1 to 999. The year must be the current or next UTC year; a past
year or any other year is 400. A second PUT replaces the target. 401 without a session.

The goal section is available on the Recap web page and can be a story data source. The July
reminder uses the same target and finished count. The server does not expose other users' goals.

## Scale conversion: 0–5 → 0–10

The server stores every rating on a 0–5 scale (reviews, ballot nominees, Recap played games, top
games, community average). The design displays 0–10. Convert in the client:

```ts
const displayRating = (rating: number) => (rating * 2).toFixed(1);
```

Examples: `4.5 → "9.0"`, `3.2 → "6.4"`, `4.75 → "9.5"`. Do not round or rescale on the server and do
not convert the community average differently from the user rating. `rating: null` means "not
rated"; render the empty state, not zero.

## Logged-out behavior

| Surface | Logged out |
| --- | --- |
| Home Awards card and event reads | Works: events, categories, results and shared votes are public. Nominations, ballot and vote need a session. |
| Home Recap card, status and Recap read | Works for a shared or known `userId`; the reads are public. A no-session viewer can open a shared Recap link. |
| Dock | Show public entries; hide personalized Recap/notification entries or show a sign-in CTA. |
| Recap web and the five stories | Works; the Recap read and status are public. |
| Ballot web/mobile | 401. Show the shared ballot path or a sign-in CTA. |
| Shared ballot link | Works with `GET /votes/:userId`, categories and the public game repository. |
| Nominations | 401. |
| Vote | 401. |
| Goal section | 401. |
| Notifications and unread badge | 401. |
| Results | Works; public. |
| Scoreboard | Public; 404 before results exist. |

Public does not mean personalized: a logged-out visitor has no ballot progress, no "me" vote, no
goal and no unread count. Never send a session-less call to a protected route and treat 401 as
"empty".

## Admin and operations

Admin endpoints are for the back office, not client screens. All require a session; a non-admin
session receives 403. They return an empty body unless noted.

| Endpoint | Body | Rules |
| --- | --- | --- |
| `POST /v1/awards/admin/event` | `{ eventId?, year, votingStartDate, votingEndDate, resultsDate, nominationStartDate?, nominationEndDate?, eligibilityCutoffDate? }` | `year` and the three voting/result dates are required. Nomination dates must be both present or both absent, start before end, and end not after voting start. A new event creates the personal-GOTY and global-GOTY categories. If an event already exists for the year without `eventId`, 400. |
| `POST /v1/awards/admin/category` | `{ categoryId?, year, name, description, order, nomineeCount? }` | The event for `year` must exist. `nomineeCount` defaults to 6. `isGOTY` is forced false; only the auto-created categories use it. |
| `POST /v1/awards/admin/category/suggestion` | `{ categoryId, gameId }` | Adds a nominee. 400 for an unknown category. |
| `DELETE /v1/awards/admin/category/suggestion` | `{ categoryId, gameId }` | Removes a nominee. A missing row is not a curated 404. |
| `PUT /v1/recap/admin/editions/:year` | `{ opensAt }` | `opensAt` must fall inside the UTC year; otherwise 400. Returns `{ year, opensAt, closesAt }`. The PUT clears the server cache; the window read is cached for 60 s. |

Operational checklist after deploy (the design's dates are data, not code):

1. Set the 2026 Awards calendar (for example, nominations 20–28 Nov, voting 1–20 Dec, results
   27 Dec) and `eligibilityCutoffDate` (for example, 30 Nov).
2. Create the 12 categories and set `nomineeCount`; the personal GOTY and global GOTY already exist.
3. Set the 2026 Recap opening with `PUT /v1/recap/admin/editions/2026`, or rely on the default
   15 Nov. With no row, the Recap is live as soon as the deploy is after 15 Nov.
4. Create the "Awards 2026" achievement in the existing achievement admin with the
   `awards_ballot_completed` metric, the `year` filter 2026, the event window and +1000 XP. No code
   seeds it.
5. Check `GET /v1/awards/events/current`, `GET /v1/recap/current` and the categories read after the
   data changes. Watch the notification outbox backlog on milestone days; fan-out is bounded per
   tick.

The `awards_ballot_completed` metric is 1 when the user voted in every category of the event year,
and 0 when the event has no categories, the event does not exist or the ballot is incomplete. It is
listed in the admin metric catalog with the `year` filter.

## Known gaps and caveats

1. **Figma frames.** The frame mapping is in [figma-frames.md](./figma-frames.md): 26 top-level
   frames, 10 product screens and the five story frames. The remaining design/server mismatches are
   listed there under "Real gaps" and repeated above where they affect the contract.
2. **Recap available notification.** A Recap first created empty and later filled with data does not
   send `available` in the current implementation, because the condition is "no previous Recap row".
   The spec scenario only covers a first generation with data; reconcile with the product owner.
3. **`totalPlayedGames` duplication.** It counts `playedGames` rows, so a game played on two sources
   can count twice. The design's "38 jogos" and "38 nós" are distinct games; use `topGames.length`.
4. **Curated 404s.** Explicit checks return 404 for a missing event on ballot/nominations/shared
   votes, and `events/current` returns 404 when none started. Other `*OrFail` reads (event by id or
   year, category, single vote, missing Recap) fall through to the generic TypeORM handler and do
   not guarantee a 404. Build the client gates from status reads and `current`, not from those
   error codes.
5. **Future Recap opening date.** `GET /v1/recap/current` returns the previous, closed year before
   the current year opens, and no public read returns a future year's opening date. That is
   intentional (design 9b) and the design has no Recap card before the opening, so no endpoint is
   added; operations copy uses the known calendar.
6. **`ongoing` library status.** The ballot play-context rule treats an entry as played only when
   its status is playing, finished or dropped, or it has a started/finished date or playtime. An
   `ongoing` entry with no dates and no playtime is reported as `planned`, so it renders with the
   wishlist label; the design has no `ongoing` state.
7. **No server-side images or OG pages.** Stories and share cards are rendered by the clients. The
    server returns data only. The Dock "new" badge is client-local.
8. **No per-user timezones.** Daily playtime, streaks, weekdays and goal years are UTC. The daily
    array is an estimate: a provider sync attributes an increment to the UTC day the observation was
    recorded, not necessarily the day it was played. Weekend and streak highlights are approximate.
    Days without play and future days are 0; a non-leap year has 365 entries and a leap year 366.
    Old Recaps with `dailyPlaytimeSeconds: null` return `calendar: null`.
9. **Cache.** The Recap read is cached server-side for 15 minutes and its key is cleared on write;
    the Recap edition window is cached for 60 s and its key is cleared by the admin PUT. A client
    query cache can still hold an older response until it is invalidated.

## Verified endpoints and fields

Verified against the current controllers, services, DTOs, entities and integration specs:

- `GET /v1/awards/events`, `/events/current`, `/events/:id`, `/events/year/:year` with the dates,
  `phase` and `categoriesCount`; `events/current` 404 when none started.
- `GET /v1/awards/:eventId/categories` with `suggestions`, `nomineeCount`, `nomineesFinalizedAt`,
  `isVotable` and the event dates.
- `GET /v1/awards/:eventId/nominations/me`; `PUT /v1/awards/:eventId/nominations/:categoryId`
  with 0–3 ids, replace/clear, personal-GOTY rejection and phase/eligibility errors.
- `GET /v1/awards/:eventId/ballot` with `phase`, progress, `playedNomineesCount`, nominee
  `status`/`playtimeSeconds`/`rating` and `suggestedGameId`.
- `GET /v1/awards/:eventId/votes/:userId` with category/game pairs, empty list and unknown-event
  404.
- `POST /v1/awards/vote` with the phase, eligibility and nominee restrictions and the two tracking
  jobs.
- `GET /v1/awards/:eventId/results` with `totalVotesCount`, `totalUniqueGamesSubmitted`,
  `totalUsersParticipating`, `totalPlayedVotesCount`, `category` and `winners[]` including
  `playedVotes`/`playedVotesPercentage`.
- `GET /v1/awards/:eventId/scoreboard/:userId` with `totals`, per-category outcomes and
  `personalGOTY`/`otherUsersCount`.
- `GET /v1/recap/current`, `GET /v1/recap/:year/:userId/status`, `GET /v1/recap/:year/:userId` with
  the totals, daily array, calendar, top games, platform split, played-game details and community
  highlights.
- `GET`/`PUT /v1/recap/goals/:year` with target 1–999, current/next-year rule and finished count.
- `GET /v1/notifications` with the three new types, targets, previews and read endpoints; the Recap
  and goal delivery paths.
- `POST /v1/awards/admin/event`, `POST /v1/awards/admin/category`, add/remove suggestion and
  `PUT /v1/recap/admin/editions/:year`.

Frame coverage is in the appendix. No endpoint in this document is missing from the current code.
