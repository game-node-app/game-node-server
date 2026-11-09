# Proposal

## Why

GameNode promised supporters a badge and title, an animated avatar border, a custom theme, a supporters wall, a live profile and a higher collection limit. No collection limit exists today, so that perk needs one to be introduced. The client can only build these once the server exposes who is a supporter and stores each supporter's choices. Profile reads are among the most frequent requests in the app because avatars fetch one profile per user, so these fields must not make them slower for the free majority.

## What Changes

- Expose an `isSupporter` flag and the supporter's stored preferences on `GET /v1/profile` and `GET /v1/profile/:id`, with the same query count as today for a public read of a non-supporter.
- Store per-supporter preferences for the badge, title key, animated avatar border, theme and accent color, wall visibility and live profile. The server validates and stores them; the client decides how to render them.
- Add a supporter-only `PATCH /v1/profile/supporter-preferences`. Preferences survive a lapse in entitlement and return on reactivation.
- Add a public, paginated `GET /v1/supporters` wall. Every active supporter appears unless they opt out. It is served from a single short-lived cached list.
- Add a public `GET /v1/profile/:id/presence` that reports the game a supporter is playing on Steam. It is opt-in, read on demand, cached per user and kept out of the profile read.
- **BREAKING**: `POST /v1/collections` rejects new collections beyond 5 for free users. Supporters have no limit. Existing collections are never removed or restricted, including for users already above the limit.
- Fix `AuthService.getLockoutStates`, which silently stops at the auth adapter's default of 100 rows. The wall depends on it and the admin profile list is affected today.
- Generate a web/mobile client hand-off as the final task. Client implementation is not part of this change.

Not included: client UI, profile video and alternate game covers (separate changes), free-text titles, presence from providers other than Steam, a batched profile read, and background presence polling.

## Capabilities

### New Capabilities

- `supporter-profile-preferences`: Public exposure of supporter status on profile reads, and storage, validation and lifecycle of the preferences that drive supporter profile perks.
- `supporters-wall`: The public list of supporters, its opt-out, exclusions, ordering, pagination and freshness.
- `live-profile`: Opt-in reporting of the game a supporter is currently playing, its sources, privacy and failure behavior.
- `collection-limits`: How many collections each plan can create and how users above a limit are treated.

### Modified Capabilities

None. `supporter-subscriptions` is only consumed through its entitlement rule, which stays in one place.

## Impact

- **API**: additive `isSupporter` and `supporterPreferences` on both profile reads; new `PATCH /v1/profile/supporter-preferences`, `GET /v1/supporters` and `GET /v1/profile/:id/presence`.
- **Code**: `src/profile` (read composition, new preferences and presence modules, DTOs), `src/billing/billing.service.ts` (list of entitled users), `src/auth/auth.service.ts` (subscription listing and lockout fix), `src/collections` (limit on creation, now depending on `BillingModule`), a new migration. `ProfileVideoService.findForProfileRead` receives the entitlement instead of looking it up.
- **Database**: new `profile_supporter_preferences` table, with rows only for supporters who change a default.
- **External services**: Steam `GetPlayerSummaries` calls on the existing API key, limited to one per opted-in supporter per cache window.
- **Clients**: additive except for the new 403 on collection creation. Web and mobile adopt the perks through the hand-off, which must also reconcile the client copy and specs that promise everything free today stays free.
