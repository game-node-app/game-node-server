# Custom game covers — client hand-off

Server implementation of custom game covers. Client implementation, UI and image fallback are a
separate change in the **`game-node-clients`** repository (the repository is named
`game-node-clients`); this document only fixes the HTTP contract and lists the client work it
implies.

Regenerate the client from `server_swagger.json`. All routes are under `/v1` and use the normal
Better Auth session (cookie or `Authorization: Bearer <token>`). Protected calls without a session
return 401. The two game repository read routes are public: they never return 401, and a missing or
invalid session is treated as anonymous.

## Contract

### `GET /v1/game/cover/{gameId}/options` (public)

Catalog data only, cached by the server for 5 minutes. No session required.

`200` returns an array of options:

```json
[
    {
        "id": 12,
        "kind": "localized",
        "label": "Japan",
        "image": {
            "id": 12345,
            "imageId": "co1abc",
            "url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg",
            "width": 264,
            "height": 352,
            "alphaChannel": false,
            "animated": false,
            "checksum": "e1f2..."
        }
    },
    {
        "id": 18,
        "kind": "edition",
        "label": "Deluxe Edition",
        "image": {
            "id": 67890,
            "imageId": "co2def",
            "url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co2def.jpg",
            "width": 264,
            "height": 352,
            "alphaChannel": false,
            "animated": false,
            "checksum": "a9b8..."
        }
    }
]
```

Fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | number | Option id. Send this as `coverOptionId` to choose the cover. |
| `kind` | string | `localized`, `edition`, `alternative` or `historical`. |
| `label` | string \| null | Region for `localized` options, edition title for `edition` options; `null` otherwise. |
| `image.id` | number | IGDB image id, not the option id. |
| `image.imageId` | string, optional | IGDB image identifier. |
| `image.url` | string, optional | IGDB image URL. |
| `image.width`, `image.height` | number, optional | Source dimensions. |
| `image.alphaChannel`, `image.animated` | boolean, optional | IGDB image flags. |
| `image.checksum` | string, optional | IGDB checksum. |

`image` has the same shape as `game.cover` in game repository responses, so existing cover
rendering and URL resizing work unchanged. The game's own default cover is never listed. On an
edition page the response also contains the base game's options, the base game's own cover and the
covers of sibling editions. A game with no alternatives returns `[]`.

| Status | When |
| --- | --- |
| 200 | Success, including an empty list. |
| 400 | `gameId` is not an integer. |
| 404 | The game does not exist. |

### `GET /v1/game/cover/{gameId}/mine` (signed-in)

`200`:

```json
{ "coverOptionId": 12 }
```

`coverOptionId` is `null` when the user has no choice for the game. This route does not check that
the game exists, so an unknown game returns `null` rather than 404.

| Status | When |
| --- | --- |
| 200 | Success, with a choice or `null`. |
| 400 | `gameId` is not an integer. |
| 401 | No valid session. |

### `PUT /v1/game/cover/{gameId}/mine` (signed-in)

Body:

```json
{ "coverOptionId": 12 }
```

`coverOptionId` must be an option id returned by the options route for that game. Choosing replaces
any previous choice for the same game. A library entry is not required.

`200` returns `{ "coverOptionId": 12 }`.

| Status | When |
| --- | --- |
| 200 | Choice stored or replaced. |
| 400 | Body is missing `coverOptionId` or it is not a number, or the option is not listed for that game. A previous choice stays unchanged. |
| 401 | No valid session. |
| 404 | The game or the option does not exist. |

### `DELETE /v1/game/cover/{gameId}/mine` (signed-in)

`200` with an empty body. Removing a choice that does not exist succeeds without effect. It is
idempotent.

| Status | When |
| --- | --- |
| 200 | Choice removed or already absent. |
| 400 | `gameId` is not an integer. |
| 401 | No valid session. |

None of these routes require a supporter subscription. A choice is independent from library
entries: deleting an entry keeps the choice, and the choice does not change the entry's update
timestamp.

### Game repository reads — personalization opt-in

Both routes are public and keep today's response shape:

- `POST /v1/game/repository`
- `POST /v1/game/repository/{id}`

New optional body fields:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `personalizeCovers` | boolean | `false` | Apply the viewer's own cover choice to the returned games. |
| `coverOwnerUserId` | string | absent | Apply this user's cover choice to the returned games. Sending it without `personalizeCovers` also opts in. |

Personalization only happens when the request also asks for the cover relation
(`"relations": { "cover": true }`). Without `relations.cover` the new fields are ignored, no session
or choice is read, and no cover is added. When both fields are present the owner field selects whose
choice is shown, subject to the viewer's display mode below.

Reads that do not opt in are unchanged, including server-side cache keys. The routes never return
401; an expired or missing session just behaves as an anonymous viewer. Do not add auth retry logic
for these routes.

The response is the same game list as today. For a personalized game, `cover` keeps the same fields
(`id`, `imageId`, `url`, `width`, `height`, `alphaChannel`, `animated`, `checksum`). The
personalized `cover.id` is the IGDB image id, not the `GameCoverOption.id`; use the option id from
the options listing for `PUT .../mine`.

### Effective cover resolution

`viewer mode` is `none` when the signed-in viewer's profile says `none`; otherwise it is the
profile's value (`any` or `prefer_yours`). An anonymous viewer is treated as mode `any` with no
choice of their own. An unknown `coverOwnerUserId` contributes no choice and the read still
succeeds.

| Viewer | Mode | Owner sent | Effective cover |
| --- | --- | --- | --- |
| Anonymous | treated as `any` | No | Default. |
| Anonymous | treated as `any` | Yes | Owner's choice, else default. |
| Signed-in | `none` | No or yes | Default. No choice is read. |
| Signed-in | `prefer_yours` | No | Viewer's choice, else default. |
| Signed-in | `prefer_yours` | Yes | Viewer's choice, else owner's choice, else default. |
| Signed-in | `any` | Yes, owner is the viewer | Viewer's choice (the viewer is the owner), else default. |
| Signed-in | `any` | Yes, owner is another user | Owner's choice, else default (even if the viewer has a choice). |
| Signed-in | `any` | No | Viewer's choice, else default. |

A game with no default cover can still receive a chosen cover. The mode and choices are read on
every personalized request, so a changed choice or mode appears immediately; only the shared game
data is cached, never the personalized result.

### Profile display mode

New profiles default to `any`. The mode is returned by `GET /v1/profile` (owner) and also by the
public `GET /v1/profile/{id}`.

`PATCH /v1/profile` accepts:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `customCoverMode` | `"any"` \| `"prefer_yours"` \| `"none"` | No | How custom covers are displayed. Leaving it out keeps the current value. |

`200` with an empty body on success; other profile fields are unchanged. `400` for a value outside
the three modes (nothing changes); `401` without a session; `404` if the signed-in user has no
profile.

### Custom cover entry filter

`hasCustomCover` is a request filter, not a returned field. It restricts library, favorites and
collection entry listings to games for which the listing owner has a cover choice, without widening
the existing visibility rules. If the owner has no choices, the page is empty.

| Endpoint | Where |
| --- | --- |
| `GET /v1/collections-entries/library/{id}` | Query parameter `hasCustomCover=true` |
| `GET /v1/collections-entries/library/{userId}/favorites` | Query parameter `hasCustomCover=true` |
| `POST /v1/collections-entries/collection/{id}` | Body field `hasCustomCover: true` |

The filter always uses the library or collection owner's choices, not the viewer's. Omit it or send
`false` to disable it. The boolean parser accepts `true`, `1`, `"true"` and `"1"`.

## Client work (in `game-node-clients`)

This repository was not inspected in this change; the bullets below are the contract implications.

- **Which surfaces send what**
    - Own library, own favorites, own collections, game detail pages and any surface without an
      owner context: send `personalizeCovers: true` with `relations: { cover: true }`.
    - Another user's library, favorites, public collection, profile or feed item: send
      `coverOwnerUserId: <that user's userId>` (and `relations: { cover: true }`). Do not send the
      viewer's id as the owner there.
    - The viewer's own id may be sent as `coverOwnerUserId`, but `personalizeCovers: true` is the
      simpler form for own content.
- **Keep personalization off in admin and Daily.** Admin screens and the Daily page must not send
  `personalizeCovers` or `coverOwnerUserId`; they keep showing the default cover. Daily is resolved
  on the server and has no viewer personalization.
- **Server-side prefetches and SSR:** do not opt in. Render the default cover first; the client
  query replaces it. The server cache is global, so a personalized prefetch must not be reused for
  another viewer.
- **Feeds:** `ActivityItem` currently sends one game repository request per item. Batch items by
  owner: one `POST /v1/game/repository` call per `coverOwnerUserId` group (own items can share the
  `personalizeCovers` call), with all game ids in that group. Every opted-in signed-in request costs
  a session and a profile lookup, so per-item requests multiply that cost.
- **Search results (Manticore):** search responses are not personalized and expose only the default
  `cover_url`. Do not apply cover choices there and do not send the opt-in fields to search.
- **Query keys:** include the cover context in every game query key: viewer identity (or signed-out
  marker), `personalizeCovers`, `coverOwnerUserId` when present and the profile's
  `customCoverMode`. Otherwise a personalized response can be reused for another viewer, owner or
  mode. Include `hasCustomCover` in library/favorites/collection keys too.
- **Invalidation:** after `PUT` or `DELETE .../mine`, invalidate game queries that can contain that
  game (detail, libraries, favorites, collections, feeds). After a profile `customCoverMode` change,
  invalidate all personalized game queries and the profile. On sign-in/sign-out, invalidate
  personalized game queries because the viewer identity changed. Entry listings carrying
  `hasCustomCover` must be invalidated after a choice change as well.
- **Image failure:** options whose IGDB source disappeared stay listed, and their image URL can
  fail. Fall back once to the default cover — use the default cover from the unpersonalized
  prefetch, or refetch the game without the opt-in fields. Do not retry the failed personalized
  URL in a loop.
- **Cover picker:** `GET .../options` is public, so the picker can load before sign-in. `PUT` and
  `DELETE` require a session; on 401 ask the user to sign in. Do not gate the picker on a library
  entry or on supporter status. On success, update local state and invalidate the queries above.
- **Mode `none`:** the server ignores even the viewer's own choice, so the picker can still store a
  choice but covers stay default until the mode changes.
- **No upload UI, no image storage, no supporter gating.** Clients only choose an existing IGDB
  option or return to the default.

## Not in this change

- No custom covers in search results, MCP, Daily, recap or other server-side consumers.
- No image upload, cropping or storage.
- No removal of cover options whose IGDB source disappears; they remain listed and clients fall
  back on image failure.
- No cover options for image types other than primary, alternative or historical.
- No client code: it is a separate change in `game-node-clients`.

This document contains no credential values.
