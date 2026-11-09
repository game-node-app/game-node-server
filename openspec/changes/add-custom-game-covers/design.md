# Design

## Context

See proposal.md for motivation and specs/ for behavior.

- `game_cover` holds one row per game (`UNIQUE(gameId)`), and `Game.cover` is read in many places, including the Daily pool.
- Clients load entries first, then call `POST /v1/game/repository` or `POST /v1/game/repository/:id` with `relations: { cover: true }`. `getCoverUrl` and `GameFigureImage` render `game.cover`.
- Both reads use `@Cacheable`, keyed by `JSON.stringify(args)` for 5 minutes in Redis, and their controller has no `AuthGuard`.
- `AuthGuard` calls Better Auth `getSession` on every guarded request, including `@Public` ones. No `cookieCache` is configured, so a signed-in request costs a database lookup.
- The sweep compares `id` and `checksum`, and `SyncEndpoint.compare` is an existing, unused way to backfill new fields.
- IGDB counts from 2026-11-09: 14,595 localized covers (`game` always empty), 9,641 historical or alternative covers with `game` set, 3,891 artworks of those types, and 8,100 games with `version_parent`.
- IGDB `image_types`: 8 Main, 9 Historical, 10 Alternative. IGDB `artwork_types` (deprecated) swap them: 9 Alternative, 10 Historical. Artworks also carry `image_type` with the same numbering as covers, but IGDB leaves it empty on about half of the 9 and 10 rows (checked against the live API on 2026-11-09). Regions are Japan, Europe and Korea.
- An expanded `covers` query returns `game_localization.game` and `game_localization.region.*` in one request.

## Goals / Non-Goals

**Goals:**

- Keep requests that do not opt in at their current cost, and add no HTTP request for those that do.
- Keep the shared game cache global, and keep `game.cover` as the only rendering contract.
- Reference each user choice through one foreign key.

**Non-Goals:**

- Personalizing Manticore search results or internal consumers such as MCP, Daily and recap.
- Cleaning options whose IGDB source disappears.
- Edition trees deeper than one level. A chained edition behaves as a base game for its own children.

## Decisions

### 1. One `game_cover_option` catalog, with `game_cover` untouched

```
game_cover_option
  id            bigint auto-increment PK
  gameId        bigint FK game, indexed       -- game that offers this option
  kind          localized|edition|alternative|historical
  origin        cover|artwork|game
  igdbId        bigint                        -- UNIQUE(origin, igdbId)
  imageId, url, width, height, alphaChannel, animated, checksum
  label         varchar(255) null

user_game_cover
  userId        varchar(36) FK profile ON DELETE CASCADE
  gameId        bigint FK game
  coverOptionId bigint FK game_cover_option ON DELETE CASCADE
  PK (userId, gameId)

game     + versionParentId bigint null FK game ON DELETE SET NULL, indexed
         + versionTitle varchar(255) null
profile  + customCoverMode varchar default 'any'
```

`origin` exists because IGDB cover, artwork and game IDs are separate sequences. An `edition` option uses `origin = game` and `igdbId = source game ID`, so replacing that game's cover updates the same row and keeps user choices.

*Alternatives:* storing variants in `game_cover` breaks `UNIQUE(gameId)`, since one game can have several non-primary covers, and artwork IDs can collide. A polymorphic reference has no foreign key, so it would need its own orphan handling. Snapshotting the URL on the user row would need sync code to update user rows.

### 2. Choice in its own table, not on `collection_entry`

A column would bump `@UpdateDateColumn`, making the entry appear modified to `findAllByUserIdInPeriod`. It would also lose the choice when the game leaves the library, and would prevent choosing without an entry.

### 3. Personalization runs after the cached read, in the controller

`findAllByIds` and `findOneByIdOrFail` keep receiving only `{ gameIds | id, relations }`, so cache keys are unchanged and internal callers are unaffected. The controller then calls `GameCoverService.applyEffectiveCovers`, which returns copies of the games it changes.

*Alternative:* passing the user into the cached method would create per-user cache keys and delay choice changes by up to 5 minutes. A separate overrides endpoint would add a waterfall to every screen.

### 4. Resolve the session only when the caller opts in

The two game repository routes do not use `AuthGuard`, which would call `getSession` on every request to the most-used read. Handlers call `AuthService.getSession` only when `personalizeCovers` or `coverOwnerUserId` is present and `relations.cover` is requested. An invalid or missing session means an anonymous viewer, never an error. `cookieCache` stays off, because it would change revocation for every route.

### 5. Resolution order and queries

```
viewer mode = 'any' when anonymous, otherwise read profile.customCoverMode
mode == none                 -> return defaults, no choice query
choices for (viewer, owner)  -> user_game_cover JOIN game_cover_option
                                by PK, gameId IN page
mode == prefer_yours         -> viewer ?? owner ?? default
mode == any, owner present   -> owner ?? default
                                (viewer == owner uses the viewer's choice)
mode == any, no owner        -> viewer ?? default
```

The option is written over `game.cover` with `id = igdbId` and the image columns, so existing URL resizing works. Games with no default cover can still receive one.

### 6. Listing and writes

`GET /v1/game/cover/:gameId/options` is `@Public` and `@Cacheable` for 5 minutes, since it holds only catalog data:

```
root = game.versionParentId ?? game.id
WHERE gameId IN (game.id, root)
  AND NOT (origin = 'game' AND igdbId = game.id)
  AND imageId <> default cover imageId
```

`PUT /v1/game/cover/:gameId/mine` takes `{ coverOptionId }` and upserts by primary key. It answers 404 when the game or option is missing and 400 when the option is not in the listing for that game. `GET` and `DELETE` on the same path act on the signed-in user's choice.

### 7. Sweep routing for option sources

`SyncEndpoint` gains optional `sweepFields`, appended to the sweep query: `game_localization,image_type` for `covers`, and `artwork_type,image_type` for `artworks`. The runner calls `IgdbCoverOptionService.syncPage` before `mismatches`:

- `covers`: rows with `game_localization`, and rows with `image_type` 9 or 10 that are not in `game_cover`, become option sources and leave the normal path.
- `artworks`: rows classified as alternative or historical become option sources, by `image_type` 10 or 9 when present and by the legacy `artwork_type` 9 or 10 otherwise, and also stay on the normal path, because they are stored in `game_artwork`.
- Only sources that are missing or have a different checksum are fetched, using one expanded query per 500 rows. Writes run inside the existing ownership guard.
- Rows that are already primary covers stay on the normal path.

Removing these rows from the normal path also stops one parent refetch per option cover in every sweep. Covers with other image types keep today's behavior.

### 8. Edition links and options

`version_parent` and `version_title` join the catalog fields, and the `games` endpoint declares `{ source: "version_parent", column: "versionParentId", target: Game }` in `compare`. That backfills editions with no job, and links a parent once it exists.

After the base game write, the import does the following:

- If the game has a stored parent, it upserts the game's option and the parent's own cover option on the parent.
- Otherwise, if any stored game points to it, it upserts its own option.

The base game's option is labeled with its name.

### 9. Filter without a new relation

`hasCustomCover` loads the library owner's chosen game IDs by primary key prefix and adds `gameId: In(ids)` to the existing find options, which keeps every visibility rule. Collection listings read the collection's owner first. An empty list returns an empty page without a listing query.

`shortcut: loads all chosen IDs of the owner, replace with a join if a user reaches tens of thousands of choices.`

### 10. Client hand-off

`handoff-clients.md` follows the pattern from `add-supporter-profile-video`. It lists the endpoints, DTOs, statuses and resolution table, and covers:

- which surfaces send `coverOwnerUserId`, and which send only `personalizeCovers`
- keeping personalization off in admin and Daily
- adding the cover context to query keys
- invalidating game queries after a change
- falling back to the default cover when an image fails
- not personalizing server-side prefetches

## Risks / Trade-offs

- [Each opted-in signed-in request adds a session and a profile lookup, and `ActivityItem` already sends one request per item] → The hand-off asks feeds to batch by owner. Measure before considering `cookieCache`.
- [An option source removed from IGDB stays listed, and its image may fail] → Clients fall back to the default cover. The sweep contract forbids deleting absent rows.
- [New options wait for the next sweep, since `covers` and `artworks` have no delta] → Accepted. Sweeps run weekly by default.
- [Server-rendered pages have no personalization, so the default cover can show first] → The hand-off keeps prefetches unpersonalized and lets the client query replace the cover.
- [Any caller can send a `coverOwnerUserId` and see that user's cover choices, including for games only in private collections] → Accepted to keep resolution simple. A choice does not require a library entry, so it does not prove the game is in the library.
- [About 1,200 covers with other image types keep refetching their parent in each sweep] → Accepted for this change, as it is today's behavior.
- [Altering large existing tables: the `game` and `profile` columns] → MySQL 8.4 adds the columns instantly and builds the `versionParentId` index in place without blocking writes. The `game.versionParentId` foreign key would force a table copy with checks on, so the migration adds it under `SET FOREIGN_KEY_CHECKS = 0`, which is safe because every value is still NULL.

## Migration Plan

1. Deploy the migration and code together. Existing clients do not opt in and see no change.
2. The next scheduled sweep fills options and edition links, within the existing budget. The cover options list stays empty until then.
3. Ship clients through a separate change in `game-node-clients`.

Rollback: revert the code and run the migration down, which drops both new tables and the columns. User choices are lost, and no catalog data is affected.
