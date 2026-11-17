# Library visibility — client hand-off

Server implementation of library and collection visibility. Client implementation, UI, copy and
translation work are a **separate change in the `game-node-clients` repository**; this document only
fixes the HTTP contract and lists the client work it implies.

Regenerate the client from `server_swagger.json` first. All routes are under `/v1` and use the normal
Better Auth session (cookie or `Authorization: Bearer <token>`). The visibility read routes are
public: they never require a session, and a missing, expired or invalid session is treated as an
anonymous viewer, not as an error. Do not add auth retry logic to them.

## Contract

### Visibility levels

`LibraryVisibility` is a string enum with exactly three values:

| Value | Who sees the content |
| --- | --- |
| `public` | Anyone, signed in or not. |
| `followers` | The owner and users who currently follow the owner. Following or unfollowing applies on the next read. |
| `private` | Only the owner. |

Any other value is rejected with `400` and nothing changes.

There are two settings with the same values:

- **`profile.libraryVisibility`** is a ceiling for the whole library. It is `public` by default.
- **`collectionEntry.visibility`** is the level of one game. It is `public` by default.

The effective visibility of a game is the **stricter** of the two. A `public` game in a `followers`
library is visible only to followers; a `followers` game in a `public` library is also visible only
to followers. The owner always sees everything. Collection membership no longer affects whether a
game is visible: a game in no collection, or only in private collections, follows its own level and
the library ceiling.

### New and changed fields

| Schema | Field | Type | Meaning |
| --- | --- | --- | --- |
| `CollectionEntry` | `visibility` | `"public" \| "followers" \| "private"` | Required in responses. The entry's own level. |
| `Profile`, `ProfileResponseDto` | `libraryVisibility` | `"public" \| "followers" \| "private"` | The library ceiling. |
| `ProfileResponseDto` | `canViewLibrary` | boolean | Whether the current viewer may see this profile's library. `GET /v1/profile` (own) always returns `true`. |
| `CreateUpdateCollectionEntryDto` | `visibility` | optional enum | On create, omitted means `public`. On update, omitted keeps the stored level. |
| `UpdateProfileDto` | `libraryVisibility` | optional enum | Omitted keeps the stored level. |
| `CollectionEntryVisibilityDto` | `visibility` | required enum | Body of the dedicated route. |

`visibility` is returned by every route that returns collection entries: single entry, related
entries, entry by game, library listing, favorites and collection listings. New entries created by
library imports and automatic sync are `public`.

When adding a game also creates entries for related DLCs or expansions, each newly created related
entry takes the main entry's level. Related entries that already exist keep their own level.

### `POST /v1/collections-entries/game/{id}/visibility` (signed-in)

Changes one game's level without resending the rest of the entry. Mirrors the favorite route.

```json
{ "visibility": "private" }
```

`id` is the **game id**, not the collection entry id.

| Status | When |
| --- | --- |
| 204 | Level stored (or already the requested one). Empty body. |
| 400 | `visibility` is missing or not one of the three values. Nothing changes. |
| 401 | No valid session. |
| 404 | The game is not in the session user's library (`Collection entry not found.`, same body as a missing entry). |

Only the session user's own entry can be changed. The route updates only `visibility`; it creates no
activity, does not touch status, level or achievements, and does not change the entry's collections.
Changes apply to the next read.

### Single-entry reads

These routes accept an optional session and apply the effective rule. A hidden entry is
indistinguishable from a missing one: same status, same body. Do not show a different error.

| Route | Hidden entry |
| --- | --- |
| `GET /v1/collections-entries/{id}` | `404` `No entry found.` |
| `GET /v1/collections-entries/{id}/related` | `404` `No entry found.` Hidden related entries are omitted from the returned lists. |
| `GET /v1/collections-entries/{id}/platforms/icons` | `404` `No entry found.` |
| `GET /v1/collections-entries/library/{userId}/game/{gameId}` | `404` `Collection entry not found.` |

For a visible entry, `collections` lists only the collections the viewer may see. The owner sees all
of their collections. A non-owner never receives a private collection name on an entry, so do not
render cached `collections` entries with `isPublic: false` for another user.

### Listings and collections

| Route | Behaviour for a non-owner |
| --- | --- |
| `GET /v1/collections-entries/library/{id}` | Only entries the viewer may see, with totals computed over them. Hidden library: `200` with an empty page (`data: []`, `pagination.totalItems: 0`, `hasNextPage: false`). |
| `GET /v1/collections-entries/library/{userId}/favorites` | Same as the library listing. Hidden library: `200` empty page. |
| `POST /v1/collections-entries/collection/{id}` | Only visible entries of a visible collection. Private collection or hidden library: `200` empty page, not 404. |
| `GET /v1/collections/{id}` | `404` `Collection not found.` when the collection is private or the library is hidden, whatever the collection's `isPublic` says. |
| `GET /v1/collections/library/{userId}` | `[]` when the library is hidden; otherwise only collections that are public **and** allowed by the library ceiling. |
| `GET /v1/libraries/{id}` | Returns the library with `collections` filtered by the same rule (`[]` for a hidden library). It does not return 404 for a hidden library; only a missing library is 404. |

A collection name, description or page is visible only when the collection is `isPublic` **and** the
viewer satisfies `libraryVisibility`. A visible collection still lists only the entries the viewer
may see.

### Profile

`GET /v1/profile/{id}` accepts an optional session and returns, in addition to the existing fields:

```json
{
    "libraryVisibility": "followers",
    "canViewLibrary": false
}
```

`GET /v1/profile` (own) returns `canViewLibrary: true` and the stored `libraryVisibility`.
Anonymous viewers are treated as non-followers.

`PATCH /v1/profile` accepts:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `libraryVisibility` | `"public"` \| `"followers"` \| `"private"` | No | New library ceiling. Leaving it out keeps the current value. |

`200` with an empty body on success; other profile fields are unchanged. `400` for any other value
(nothing changes); `401` without a session; `404` if the signed-in user has no profile. Changing the
ceiling does not change any stored entry level.

### Journal, playtime, metrics, recap

| Route | Behaviour |
| --- | --- |
| `GET /v1/journal/overview/{userId}` | Overview computed only over games the viewer may see. Hidden library: empty overview, `200`. |
| `GET /v1/journal/heatmap/{userId}` | Heatmap over the same visible games. Hidden library: empty heatmap, `200`. |
| `GET /v1/journal/playlog/{userId}/{gameId}` | `404` when the library or that game's entry is hidden. |
| `GET /v1/playtime/user/{userId}/{gameId}` | `[]` when the game's entry or the library is hidden. |
| `GET /v1/playtime/user/{userId}/{gameId}/accumulated` | Zero totals when the game's entry or the library is hidden. |
| `GET /v1/playtime/user/{userId}` | Only games the viewer may see. Hidden library: empty page. |
| `POST /v1/playtime/user/{userId}` | Same filtered result. Hidden library: empty page. |
| `GET /v1/profile/metrics/overview/{userId}` | Counts only visible games and collections. Hidden library: every count and total is `0`. |
| `GET /v1/profile/metrics/distribution/year/{userId}` | Same rule. Hidden library: empty/zero distribution. |
| `GET /v1/profile/metrics/distribution/type/{userId}` | Same rule. Hidden library: empty/zero distribution. |
| `GET /v1/profile/metrics/report/{userId}/{period}` | Computed over visible games and collections. Hidden library: every count is `0`. |
| `GET /v1/profile/metrics/summary/{userId}/{period}` | Same rule. Hidden library: zero summary. |
| `GET /v1/recap/{year}/{userId}` | `404` when the library is hidden. A visible recap omits hidden games from `playedGames`. |
| `GET /v1/recap/{year}/{userId}/status` | `404` when the library is hidden. |

Playtime without a library entry stays visible when the library itself allows the viewer. Recap
totals and distributions computed when the recap was generated may still include hidden games; only
the list of played games and access to the recap are enforced, as the spec states.

### Activities

| Route | Behaviour |
| --- | --- |
| `GET /v1/activities` | `COLLECTION_ENTRY` activities the viewer may not see are omitted. |
| `GET /v2/activities` | Same rule. |
| `GET /v1/activities/detail/{id}` | `404` `No activity found.` for a hidden activity, same as a missing one. |
| `GET /v1/activities/feed` | Same filtering. The following feed is cached per viewer for 5 minutes, so a just-hidden item can remain there for up to 5 minutes. |

Liking or commenting on a hidden activity fails with `404` (`Source not found or inaccessible` for
likes, `Target activity not found` for comments) and creates no statistics or notification intent.
A private collection referenced by a visible activity is not exposed to non-owners.

### Reviews stay public

Reviews are not affected by this change. A review of a hidden game, or of a game that is only in
private collections, remains visible in review listings, rankings, scores and review notifications.
Say so next to the visibility control, for example: "Reviews are always public."

## Regenerating the client

1. In this server repository, start the app once (`pnpm start`, or `pnpm build` followed by
   `node dist/src/main`). `src/main.ts` writes `server_swagger.json` at the repository root.
2. Copy the regenerated `server_swagger.json` to `packages/wrapper/input/server_swagger.json` in
   `game-node-clients`.
3. Run `pnpm wrapper:generate` there.
4. Adjust generated consumers: `CollectionEntry.visibility` is now a required property, and the new
   `CollectionEntryVisibilityDto` and `LibraryVisibility` enum values (`public`, `followers`,
   `private`) must be handled. Exhaustive `match(...).exhaustive()` calls will fail to compile until
   the three branches exist.

## Client work (in `game-node-clients`)

This repository was not inspected in this change; the bullets below are the contract implications.

- **Per-game control (owner only)**
    - Add a visibility select with the three levels to the entry form, in
      `CollectionEntryFormDetailsPanel`. Initialize it from the entry's `visibility`; a new entry
      defaults to `public`. Send `visibility` in the create/update body, or omit it to keep the
      stored level on update.
    - Add a quick action next to the favorite action on the owner's game cards / game detail page.
      It calls `POST /v1/collections-entries/game/{id}/visibility` with the chosen level. Update
      the cached entry optimistically, then roll back and show an error if the request fails.
    - Show an indicator on the owner's own cards when the entry is not `public` (`followers` or
      `private`), so the owner can see which games are restricted. `public` needs no badge.
    - Do not show the control on another user's entries.
    - Put the "Reviews are always public." note next to the control.
    - Collections are no longer a proxy for game visibility. Remove any UI assumption that a game
      only appears because it is in a public collection.
- **Privacy settings**
    - Enable the existing **"Library and collections"** row in `SettingsPrivacyVisibilitySection`
      with the three levels; the row currently shows "Coming soon" and is disabled.
    - Keep the **Profile** and **Activity** rows disabled and marked "Coming soon".
    - Replace the row copy, which today says "Default for new collections", with copy that describes
      the ceiling: the profile level caps what other users can see, and each game can be more
      restrictive than the library, never less.
    - Update the public/private switch description in the collection form to say that it hides the
      collection (its name, page and membership) but **does not hide the games in it**.
    - After a successful `PATCH /v1/profile`, update local profile state and invalidate the profile
      and library queries listed below.
- **Profile and library views**
    - Use `canViewLibrary` and `libraryVisibility` from the profile read to render the empty state:
      `private` → "This library is private"; `followers` → "Only followers can see this library"
      with the follow action. Do not show a generic empty library when the library is hidden.
    - Replace the `noPublicFavoriteGames` copy and condition; favorites are now hidden only by the
      library ceiling and the per-game level, not by collections.
    - If a stale cache still holds private collections in an entry's `collections`, do not render
      them for another user.
    - Treat `404` on another user's entry (`GET` entry, entry by game, related, play log), collection
      or recap as "not visible": show the hidden/empty state, not an error toast or retry loop.
- **Query keys and invalidation**
    - Include the viewer identity (or an explicit signed-out marker) in the keys of every
      session-aware read of another user's data: profile, library, favorites, collections,
      collection entries, journal, playtime, profile metrics, recap and activities. Otherwise a
      follower's response can be reused for a non-follower or an anonymous visitor.
    - After follow or unfollow, invalidate the followed user's profile, library, favorites,
      collections, journal, playtime, metrics and recap queries.
    - After changing a game's visibility or the profile's `libraryVisibility`, invalidate the
      owner's library, favorites, collection and entry queries and the profile query, so the new
      state appears without a reload.
    - The server applies visibility changes on the next read; only the following feed can lag up to
      the 5-minute cache window.
- **Translations and parity**
    - Add the same keys to `en.json` and `pt-BR.json`: at least the three level labels and
      descriptions, the per-game control label, the owner badge label, the "Reviews are always
      public." note, the Privacy row title/description and the two hidden-library empty states.
    - Implement the same control, indicators and empty states on web and mobile. Keep the components
      and translation keys shared where the clients already share them.
    - Add a changeset covering the `web` and `mobile` packages.

## Not in this change

- No client code: the client implementation is a separate change in `game-node-clients`.
- No changes to Profile and Activity privacy rows; they stay "Coming soon".
- Achievements, obtained-achievement activities, profile presence ("playing now") and the Daily game
  are not gated by library visibility.
- No follow requests, approval or blocking.
- No three-value setting for `Collection.isPublic`.
- No client-side enforcement: the server is the source of truth for every rule above.

This document contains no credential values.
