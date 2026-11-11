# Client hand-off: supporter profile perks

Server-side implementation of `add-supporter-profile-perks` is complete. Client implementation is a **separate change in `game-node-clients`** and is not part of this server change.

This document is the contract for that client work. Endpoints, fields, defaults and statuses were checked against the implemented DTOs and the regenerated `server_swagger.json`.

## 1. Profile reads

`GET /v1/profile` (owner, session required) and `GET /v1/profile/:id` (public) return two new fields:

| Field | Type | Notes |
| --- | --- | --- |
| `isSupporter` | boolean | Always present. Uses the existing entitlement rule. |
| `supporterPreferences` | object or null | The seven fields below. `null` while `isSupporter` is false. |

`supporterPreferences` fields and defaults (a supporter who never changed anything gets exactly these):

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `showBadge` | boolean | `true` | Display choice for the supporter badge. Does not affect `isSupporter`. |
| `titleKey` | string or null | `null` | Translation key; the client owns the catalog (section 5). |
| `showAnimatedAvatarBorder` | boolean | `true` | Display choice for the animated border. |
| `showSupporterTheme` | boolean | `true` | Display choice for the supporter theme. |
| `accentColor` | string or null | `null` | `#RRGGBB`, chosen by the supporter. |
| `showOnSupportersWall` | boolean | `true` | Wall visibility (section 3). |
| `showLiveProfile` | boolean | `false` | Opt-in for presence (section 4). |

Rules the client can rely on:

- `supporterPreferences` is `null` when the user is not entitled, including after a lapse and when the entitlement lookup fails during a read. Stored preferences are kept and returned again when entitlement resumes.
- Preferences come with the profile read; no extra request is needed for the owner's current values.
- `showBadge: false` does **not** hide `isSupporter` and does not turn off other perks.
- Profile reads never contact Steam and never include the current game; presence is only available from its own endpoint.

## 2. `PATCH /v1/profile/supporter-preferences`

Session required; supporter entitlement required. The body may contain any subset of the seven fields. Omitted fields stay unchanged, and `{}` is valid: it writes nothing and returns the current values.

```json
{
  "showBadge": true,
  "titleKey": "founder",
  "showAnimatedAvatarBorder": true,
  "showSupporterTheme": true,
  "accentColor": "#FF8800",
  "showOnSupportersWall": true,
  "showLiveProfile": false
}
```

Validation:

- `accentColor`: `#RRGGBB` (six hex digits, leading `#`) or `null` to clear. Contrast is a client responsibility.
- `titleKey`: 1–32 characters of lowercase letters, digits, `_` or `-`, or `null` to clear. Free text is rejected.
- Booleans must be JSON booleans, not strings or numbers.
- Partial updates are safe: concurrent requests do not overwrite omitted fields.

Responses:

| Status | When | Body |
| --- | --- | --- |
| 200 | Accepted | The complete resulting preferences, same seven fields as a profile read, not only the changed ones. |
| 400 | Invalid `accentColor`, `titleKey` or boolean type | Validation error. Nothing is stored. |
| 401 | No session | Nothing is stored. |
| 403 | Authenticated user without supporter entitlement | Nothing is stored. |

After a successful update the next wall read and the next presence read reflect the change immediately: the server invalidates both caches. Other reads may lag by their TTL.

Swagger: `server_swagger.json`, `PATCH /v1/profile/supporter-preferences`, request `UpdateSupporterPreferencesDto`, response `SupporterPreferencesResponseDto`.

## 3. `GET /v1/supporters` (supporters wall)

Public, no session.

Query parameters:

| Name | Type | Default | Bounds |
| --- | --- | --- | --- |
| `offset` | integer | `0` | `>= 0` |
| `limit` | integer | `20` | `1..100`; `101` responds 400 |

Response:

```json
{
  "data": [
    { "userId": "uuid", "username": "someone", "avatar": null }
  ],
  "pagination": {
    "totalItems": 1,
    "totalPages": 1,
    "hasNextPage": false
  }
}
```

- Items contain only `userId`, `username` and `avatar` (the same avatar object used by profile reads, or `null`). No status, plan, billing interval or subscription dates.
- Ordered by `username` ascending; pagination is `offset`/`limit` over that order.
- Every entitled user appears by default. `showOnSupportersWall: false` removes that user; the next read after the PATCH reflects it.
- Users without current entitlement, banned users and suspended users are excluded. Canceled subscriptions still inside the paid period are included.
- The list is cached for up to 10 minutes, so entitlement or profile changes not made through the preferences PATCH can take up to that long to appear.
- If Stripe is not configured the endpoint responds 200 with an empty list.

## 4. `GET /v1/profile/:id/presence`

Public, no session. Always responds 200, including for an id that does not exist.

```json
{ "playing": null }
```

or

```json
{
  "playing": {
    "source": "steam",
    "name": "Game name from Steam",
    "gameId": 12345
  }
}
```

- `playing` is non-null only when the user has supporter entitlement, `showLiveProfile` is true and a Steam account is connected. Otherwise it is `null` (also when not playing, when Steam details are private, on Steam failure and for unknown users).
- `gameId` is the GameNode game id, or `null` when the Steam game is not in the catalog.
- The server computes presence lazily and caches it per user for 60 seconds. Nobody viewing a profile means no Steam call; many viewers within the window share one call per server process.
- Recommended client polling: **at most once per 60 seconds**, only while the profile screen is visible, and only when that profile's `showLiveProfile` is true. Do not poll in lists or in the background.
- Disabling `showLiveProfile` makes the next presence read return `playing: null`.

## 5. Rendering responsibilities (client)

- The `titleKey` catalog is owned by the client. The server only validates the key format, so new titles need no server release. Ignore a key the client does not know.
- `accentColor` is stored as sent; the client is responsible for readable contrast in its own themes.
- The animated avatar border must honour `prefers-reduced-motion`; this is client-side only.
- `showBadge` is a display choice. `isSupporter` remains true when the badge is hidden, and other active perks can still reveal supporter status.
- The server stores and returns preferences without interpreting them.

## 6. Collection limit (breaking for free users)

`POST /v1/collections` rejects a new collection when a user without supporter entitlement already owns **5** or more. Supporters have no limit. Existing collections are never removed, hidden or restricted: the limit applies to creation only, and a user can create again after dropping below 5.

Rejection body (HTTP 403):

```json
{
  "message": "Collection limit reached.",
  "code": "collection_limit_reached",
  "limit": 5
}
```

Client handling:

- In `packages/ui/src/components/collection/form/CollectionCreateOrUpdateForm.tsx`, branch on `code === "collection_limit_reached"` rather than on status 403 alone, and show the upgrade path. Other 403 responses keep their existing generic handling.
- The server does not expose the limit on a read endpoint; the error carries it. The client already knows the user's current count from the collection list.
- If entitlement cannot be determined while deciding at or above the limit, the server responds with a server error and creates nothing.

Required reconciliation in `game-node-clients`:

- The copy in `packages/locales` says "Everything you use today stays free".
- The `redesign-supporter-settings` and `add-supporter-subscriptions` specs say the catalog SHALL NOT gate features that are free today.
- The new limit contradicts both for anyone creating collections past 5. Update the copy and those specs in `game-node-clients` in the same release, before or with the server deploy. This server change cannot fix client copy.

## 7. Scope reminder

This document describes only the server contract. Implementing the UI, polling, translation catalog and copy/spec reconciliation is a separate change in `game-node-clients`.
