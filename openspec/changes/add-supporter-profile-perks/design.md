# Design

## Context

See proposal.md for motivation and the specs for behavior.

- `UserAvatar` calls `useUserProfile` once per distinct user, so `GET /v1/profile/:id` is hit once per person on any list. The response is built in `ProfileController.findWithVideos`.
- Today a public read runs the profile query and then the `profile_video` query, plus `isSupporter` only when a published video exists.
- `isSupporter` is a lookup on `subscription.referenceId`, which is indexed, and returns zero rows for free users. Entitlement is time-dependent (`grantsEntitlement`: grace period and paid period end).
- `Profile` is joined as a relation by many other entities and returned inside their responses.
- Better Auth's adapter `findMany` limits results to 100 rows unless given a `limit`. `getLockoutStates` passes none, so it is truncated at 100 users.
- Provider chain from the video change: `ProfileService` cannot depend on `BillingService` (`BillingService -> AuthService -> UserInitService -> ProfileService`).
- `steamapi`'s `UserSummary` already exposes `gameID` and `gameName`, and `SteamSyncService.getUserSummary` exists. `gameID` is typed as a number, while `getExternalGamesForSourceIds` drops anything that is not a string.
- `@Cacheable` builds its own key, so its entries cannot be invalidated by name.

## Goals / Non-Goals

**Goals:**

- A public read of a non-supporter runs the same number of queries as today.
- Nothing slow or external is reachable from a profile read.
- Entitlement keeps one rule and one source of truth, so no webhook drift can grant or remove a perk.

**Non-Goals:**

- Reducing the existing one-request-per-avatar pattern. A batched read needs client rework across `useUserProfile` consumers.
- Caching individual profile reads. A Redis round trip costs about the same as the indexed lookups it would replace.

## Decisions

### 1. Read composition: entitlement first, then only what it unlocks

```
GET /v1/profile/:id
  parallel: profile query + subscription lookup
  if supporter: parallel: profile_video query + preferences query
  else:         nothing more (public read)
```

| Read | Today | New |
| --- | --- | --- |
| Public, non-supporter | profile, videos | profile, entitlement |
| Public, supporter without video | profile, videos | profile, entitlement, videos, preferences |
| Public, supporter with video | profile, videos, entitlement | profile, entitlement, videos, preferences |
| Owner, non-supporter | profile, videos | profile, entitlement, videos |

`findForProfileRead` receives `isSupporter` instead of looking it up, and skips the `profile_video` query when the owner is not a supporter and `includeUploads` is false. Running the first pair in parallel makes latency the slower of the two rather than their sum. The controller keeps the composition and calls the existing `ProfileVideoService.isSupporter`, which already turns a lookup failure into `false`.

Alternative rejected: a denormalized `supporterUntil` on `profile`, updated from the Stripe hook. It would save one indexed lookup, at the cost of a backfill, a second copy of the time-based rule and a stale value whenever a webhook is missed. It can be added later without changing the API if measurements call for it.

Alternative rejected: an existence hint such as "has a preferences row" to skip the entitlement lookup. A zero-row indexed lookup is already that hint.

### 2. Preferences live in their own table

New table `profile_supporter_preferences`:

| Column | Type | Default |
| --- | --- | --- |
| `profileUserId` | `varchar(36)` PK, FK to `profile.userId` `ON DELETE CASCADE` | |
| `showBadge` | boolean | true |
| `titleKey` | `varchar(32)` null | null |
| `showAnimatedAvatarBorder` | boolean | true |
| `showSupporterTheme` | boolean | true |
| `accentColor` | `char(7)` null | null |
| `showOnSupportersWall` | boolean | true |
| `showLiveProfile` | boolean | false |

A row exists only after a supporter changes something. A missing row means the defaults, which a single constant holds for reads and the migration mirrors. Free users therefore add no rows.

Alternative rejected: columns on `profile`. They would need no extra query on reads, but every relation load of `Profile` across the codebase would carry them, and they would leak into responses of a user whose entitlement ended. Alternative rejected: one JSON column, which saves little and removes type and null guarantees for the wall's filter.

### 3. Title is a key, not text

`titleKey` is an identifier the client maps to translated copy. Free text would need moderation and allows impersonation such as "Admin". The server only validates the format, so new titles need no server release; a client ignores a key it does not know.

### 4. Preferences endpoint

`PATCH /v1/profile/supporter-preferences` in a new controller with `AuthGuard` and `SupporterGuard` (exported from `ProfileVideoModule`, or moved to `BillingModule` if that avoids a module cycle). `repository.upsert` writes only the provided fields, so concurrent partial updates cannot lose each other and column defaults apply on the first insert. An empty body skips the write. The owner reads current values from `GET /v1/profile`, so no new GET is needed.

There is no route conflict: `GET /v1/profile/:id` only matches GET. The wall uses `/v1/supporters` because `GET /v1/profile/supporters` would compete with `:id`.

Module: `src/profile/supporter-preferences`, imported by `ProfileModule`, depending on `BillingModule`. `AuthModule` is global.

### 5. Wall: one cached list, sliced per page

```
GET /v1/supporters?offset&limit
  cache key supporters:wall (10 min), via CACHE_MANAGER
    miss: BillingService.findSupporterUserIds()
          minus banned/suspended (getLockoutStates)
          minus showOnSupportersWall = false
          profiles IN (ids) with avatar, ORDER BY username
  slice in memory, [items, total] through PaginationInterceptor
```

A single key means query-string variations cannot create cache entries or reach the database, and a page costs one Redis read. Items carry the avatar so the client does not fetch one profile per wall item.

`BillingService.findSupporterUserIds` reads subscriptions with status in `active`, `trialing`, `past_due`, `canceled` through a new `AuthService` adapter call and applies `grantsEntitlement`, keeping the rule in one place. The adapter call passes an explicit `limit` taken from `adapter.count`, because the default of 100 would silently cut the wall. `status` gets no index: the table holds only people who ever subscribed and the read runs at most once per window.

`getLockoutStates` gains `limit: userIds.length`, which also fixes the admin profile list.

`CacheInterceptor` was rejected because it keys by URL and would allow unbounded keys on a public route. `@Cacheable` was rejected because its key cannot be deleted on opt-out.

### 6. Presence is a separate, lazily computed endpoint

```
GET /v1/profile/:id/presence
  cache hit (profile-presence:<id>, 60 s) -> return
  entitlement + showLiveProfile -> no: store { playing: null }
  Steam connection              -> none: store { playing: null }
  getUserSummary(sourceUserId)  -> failure/no game: store { playing: null }
  getExternalGamesForSourceIds([String(gameID)], Steam) -> gameId or null
  store result, return
```

Results are always the object `{ playing }`, so null results are cached too and repeated reads of free users stay cheap. The endpoint is public like `GET /v1/connections/user/:userId`, which already exposes the same Steam account.

On-demand reads over a background poll: polling spends Steam quota on profiles nobody opens. The cost is that a viewer sees data up to 60 seconds old.

Live in `src/profile/profile-presence`, imported from `AppModule` and not from `ProfileModule`, because `ConnectionsModule` already has forward references into collections and playtime.

Steam only for v1: PSN, Xbox and Epic have no equivalent call in the existing clients, and the desktop app's local session measurement would need a new reporting channel.

### 7. Preference changes invalidate caches

After a successful PATCH, the service deletes `supporters:wall` and `profile-presence:<userId>`. Updates are rare and supporter-only, so always deleting both is simpler than diffing fields and costs one recomputation at most. Cache deletion failures are logged and do not fail the request; the TTL is the backstop. Exported key builders keep the names in one place.

### 8. Client hand-off contents

`handoff-clients.md` covers: new read fields, defaults, the PATCH contract and errors, the wall contract, the presence contract and a recommended poll of at most once per 60 seconds while the profile is visible and only when `showLiveProfile` is true, the `titleKey` catalog being owned by the client, rendering guidance (accent color contrast and `prefers-reduced-motion` for the border, both client responsibilities), and the fact that `showBadge` is a display choice and does not hide `isSupporter`. It also covers the collection limit: the value, the 403 body, handling it in `packages/ui/src/components/collection/form/CollectionCreateOrUpdateForm.tsx`, and a required reconciliation in `game-node-clients`. The copy in `packages/locales` says "Everything you use today stays free", and the `redesign-supporter-settings` and `add-supporter-subscriptions` specs say the catalog SHALL NOT gate features that are free today. The new limit contradicts both for anyone creating collections past 5.

### 9. Collection limit is enforced at creation, in the service

`POST /v1/collections` is the only path that creates a collection: nothing is created at signup or by the importer, which only picks an existing one. `CollectionsService.create` therefore holds the whole rule, with the free limit as a single constant of `5`. Supporters have no cap, so there is no second value.

```
transaction
  lock the user's library row (FOR UPDATE)
  count collections WHERE libraryUserId = ?
  count < 5   -> insert
  otherwise   -> isSupporter ? insert : 403
```

Locking the `library` row serializes creates per user, matching the `pessimistic_write` pattern already used in `update` and `delete`. Without it, two parallel requests at the boundary would both pass the count. The contention is limited to one user's creates, and the count uses the FK index on `libraryUserId`.

Entitlement is consulted only at or above the free limit, so a creation below it costs no billing lookup. The direct `BillingService.isSupporter` is used, not the swallowing wrapper from `ProfileVideoService`: treating a lookup failure as "not a supporter" would wrongly tell a paying user to upgrade, so it fails with 500 and nothing is created.

`CollectionsModule` imports `BillingModule`. Unlike `ProfileService`, this adds no cycle: `UserInitService` depends on libraries, profile and level, none of which depend on `CollectionsService`. Task 6.1 verifies boot.

The error is `HttpException({ message, code: "collection_limit_reached", limit }, 403)`. The limit is not exposed on a read endpoint: the error carries it, and the client already knows the user's count from the collection list.

Alternatives rejected: a guard (it would need its own count and could not share the lock), and archiving or hiding collections above the limit (it destroys access to data users built while no limit existed).

## Risks / Trade-offs

- [Every profile read gains an entitlement lookup] -> Offset by skipping the video query for non-supporters; the count is unchanged for public reads. Verified by a query-count test.
- [Better Auth adapter overhead on the hottest read] -> One indexed `SELECT`. If it shows up in profiling, replace it with a direct query in `AuthService` without changing callers.
- [`isSupporter` remains visible when a supporter hides the badge or opts out of the wall] -> Accepted: preferences are display choices and active perks such as a border reveal it anyway. Documented in the hand-off.
- [Whole-list cache grows with supporters] -> Small at this scale: about 200 bytes per item. Upgrade to a paged query when the list passes a few thousand; recorded as a `shortcut:` comment.
- [Steam quota is shared with sync jobs] -> At most one call per opted-in supporter per minute and only while viewed. Lengthen the TTL if quota alarms appear.
- [Cache miss stampede on the wall after invalidation] -> Bounded by the small number of queries and rare updates; no lock added.
- [A free limit of 5 is low and many existing users may already be at it] -> They keep everything and only lose the ability to create more. Task 8.3 records how many are affected before deploy.
- [Free users lose something that was unlimited] -> Existing collections are untouched and only new ones past the limit are refused. The client copy promising otherwise must change in the same release (design 8).
- [Entitlement lookup while holding the library row lock] -> One indexed read, only at or above the free limit, and the lock covers a single user's creates.

## Measurements

Task 8.2, measured on 2026-11-10 against a local MySQL 8.4 and Redis instance, comparing `HEAD` 7397578 (before) with the working tree containing waves 1–4 (after). Both builds were started with `node dist/src/main` and the repository `.env`.

- **Dataset:** 10,536 `profile` rows (the 536 existing fixtures plus 10,000 seeded `bench_*` rows), 5 `subscription` rows and 2 `profile_video` rows. The existing rows were not modified.
- **Target:** `00647243-01e3-496d-a6b9-e2aabb06f640`, a non-supporter with no `profile_video` rows and a static avatar.
- **Method:** cold boot, 10 warm-up requests, then 100 sequential `GET /v1/profile/<target>` from a Node script using `fetch` and `performance.now`. Query counts came from MySQL `general_log`: one request per build, counting statements whose parameters contain the target id, so scheduler queries for other ids are excluded. Same dataset for both builds.
- **Ports:** before on 5055, after on 5056.

| Non-supporter public read | Before | After |
| --- | --- | --- |
| Statements per request | 3 | 3 |
| Queries with the target id | profile relation (2 statements), video | profile relation (2 statements), entitlement |
| Latency p50 / p95 / mean, first pass | 3.83 / 5.05 / 3.99 ms | 3.62 / 4.24 / 3.62 ms |
| Latency p50 / p95 / mean, second pass | 4.07 / 6.20 / 4.67 ms | 3.59 / 4.21 / 3.65 ms |

The design counts two reads, and that is what the endpoint issues: profile plus video before, profile plus entitlement after. TypeORM loads the `Profile` relation in two physical statements (a `SELECT DISTINCT` id query and the main select), so both sides log three statements. The after side issues no video and no preference query for a non-supporter. The after column's second pass was measured on the final build; the first pass differs only in Swagger annotations. A third after run reached p50 3.02 / p95 3.93 ms, which shows the run-to-run spread.

Conclusion: query count is unchanged and latency is equal or slightly lower; no regression beyond noise. These are warm local numbers, not production latency.

### Pending: production collection distribution (task 8.3)

Not executed here: the production MySQL is not publicly reachable from this environment (`is_public: false`, no port mapping). Run this read-only query before deploying and record the result in this section:

```sql
SELECT collection_count, COUNT(*) AS libraries
FROM (
    SELECT libraryUserId, COUNT(*) AS collection_count
    FROM collection
    GROUP BY libraryUserId
) per_library
GROUP BY collection_count
ORDER BY collection_count;
```

The sum of `libraries` for `collection_count >= 5` is the number of users who can no longer create a collection after the deploy.

## Migration Plan

1. The `server_migration` service creates `profile_supporter_preferences` before the server starts.
2. Record the limit's impact with task 8.3, and ship the client copy change with or before the server deploy.
3. Deploy the server. Apart from the collection limit, API changes are additive, and the wall and presence endpoints are unused until clients adopt them.
4. Rollback: redeploy the previous image; the extra table is ignored and the limit disappears.
