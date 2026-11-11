# Tasks

## 1. Foundation

- [x] 1.1 Add the `ProfileSupporterPreferences` entity, the defaults constant and a raw-query migration for `profile_supporter_preferences` (design 2), and verify the migration runs up and down on a clean database with the FK cascade present.
- [x] 1.2 Pass `limit: userIds.length` in `AuthService.getLockoutStates` and verify with a test that more than 100 ids are all evaluated and that `ProfileService.findAll` still returns correct lockout flags.
- [x] 1.3 Add the `AuthService` subscription listing and `BillingService.findSupporterUserIds` reusing `grantsEntitlement` (design 5); verify with tests for each status, grace and paid-period expiry, duplicate rows for one user, more than 100 rows and Stripe not configured.

## 2. Preferences

- [x] 2.1 Add the `src/profile/supporter-preferences` module, the service with a read that falls back to defaults, and the update DTO with the validation in the spec; verify with DTO tests for valid and invalid `accentColor`, `titleKey` and booleans, and null clearing.
- [x] 2.2 Add `PATCH /v1/profile/supporter-preferences` with `AuthGuard` and `SupporterGuard` (design 4, 7), making `SupporterGuard` importable without a module cycle; verify with tests for 200, 400, 401 and 403, partial updates, the empty body skipping the write, cache keys deleted after a save, a cache failure not failing the request, and the application booting with no new provider cycle.
- [x] 2.3 Verify with an integration test that account deletion removes the preferences row and that preferences persist through a loss of entitlement.

## 3. Profile reads

- [x] 3.1 Change `findForProfileRead` to receive `isSupporter` and skip the query when the owner is not a supporter and uploads are not requested; update `profile-video.service.spec.ts`, replacing the "not called without a video" expectation, and verify all `profile-media` read scenarios still pass.
- [x] 3.2 Compose `isSupporter` and `supporterPreferences` in `ProfileController` following design 1, and update `ProfileResponseDto` for Swagger; verify with tests for supporter, non-supporter, lookup failure, lapsed supporter with stored preferences, owner upload status, and a query-count assertion that a public non-supporter read touches only the profile and entitlement and resolves entitlement once.

## 4. Supporters wall

- [x] 4.1 Add the service and `GET /v1/supporters` with the single cache key and in-memory slicing (design 5), including a `shortcut:` comment for the whole-list cache and its upgrade trigger; verify with tests for opt-out, default visibility, banned and suspended exclusion, lapsed exclusion, username order, offset and limit, total, `limit` above 100 returning 400, no billing data in items, Stripe not configured, a cache hit making no queries, and opt-out applying on the next read.

## 5. Live profile

- [x] 5.1 Add the `src/profile/profile-presence` module and `GET /v1/profile/:id/presence` following design 6, converting `gameID` to a string for the mapping lookup; verify with tests for a mapped game, an unmapped game, not playing, private details, preference off, non-supporter, no connection, unknown user, Steam failure, at most one Steam call per cached window, cached null results, and the application booting with no new provider cycle.
- [x] 5.2 Verify with a test that profile reads for an opted-in supporter never call `SteamSyncService`, and that disabling `showLiveProfile` makes the next presence read return null.

## 6. Collection limit

- [x] 6.1 Enforce the limits in `CollectionsService.create` following design 9, importing `BillingModule` and updating the positional constructor calls in `notifications-e2e.integration.spec.ts` and `notifications-lifecycle.integration.spec.ts`; verify with tests for free users below and at the limit, supporters at and far above it, the 403 body, no entitlement lookup below 5, a lookup failure returning 500 with nothing created, and the application booting with no new provider cycle.
- [x] 6.2 Verify with an integration test against MySQL that two parallel creations by a free user at 4 collections produce exactly one, and with tests that a user above the limit can still read, update, delete and add games, and can create again after dropping below it.

## 7. Spec check

- [x] 7.1 Run `openspec validate add-supporter-profile-perks --strict` and compare each scenario in the four specs with a passing test or a recorded manual check, listing any gap in the change.

## 8. Integration

- [x] 8.1 Run `yarn build`, the unit suite and the affected integration suites, and verify they pass.
- [x] 8.2 Measure `GET /v1/profile/:id` for a non-supporter before and after the change against a local database with production-like row counts, and record the query count and latency in `design.md`, verifying no regression beyond noise.
- [ ] 8.3 Query production for the distribution of collections per library, and record in `design.md` how many users are already at or above 5, so the owner knows the impact before deploying.

## 9. Client hand-off

- [x] 9.1 Regenerate `server_swagger.json` and write `handoff-clients.md` in this change with the contents in design 8, stating that client implementation is a separate change in `game-node-clients`; verify every endpoint, field, default and status matches the implemented DTOs.

## Workflow follow-up

- Archive the change after the hand-off is delivered and the implementation is reviewed.
