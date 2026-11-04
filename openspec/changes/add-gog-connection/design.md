# Design

## Context

See `proposal.md` for motivation and scope, and the six spec deltas for acceptance behavior.

Observed in the repository:

- Epic and Nintendo already use delegated-code onboarding. `ConnectionsService` owns single-use Redis state, collection validation, credential persistence and initial sync scheduling. `ConnectionCredentialService` encrypts tokens; `markReauthRequired` owns the transactional status/notification transition.
- Provider registration supplies authentication and player handlers. Import discovery uses `ImporterService.matchUnprocessed`; player work shares budgets, deadlines, ownership guards and attempt-local snapshots in `player-sync-attempt.ts`.
- `Gog = 5`, `UserPlaytimeSource.GOG` and `public/icons/gog.png` exist. GOG is absent from connection/importer enums, source conversions, registry registrations, achievement-source allowlists, notification provider lists and the MCP category filter.
- Game achievement definitions are fetched by `GameAchievementService`; user progress dispatches through `GameObtainedAchievementService`. The queue service and processor explicitly recognize Steam/PSN/Xbox jobs. Completion, activities and obtained rows already commit together.
- `GameAchievementService.findAllByExternalGameIdForSync` currently receives only an external-game ID. GOG's combined response is account-specific, so catalogue reads during a user sync must receive that user's identity as well.
- Nintendo code is present under an active change, while some main specs still enumerate the older providers. This change adds GOG without archiving Nintendo or removing its runtime behavior. Reconcile overlapping scenario additions when those changes are eventually synced or archived.

External evidence, read during planning on 2026-11-03:

- [heroic-gogdl auth source](https://github.com/Heroic-Games-Launcher/heroic-gogdl/blob/main/gogdl/auth.py) implements code exchange and refresh at `auth.gog.com/token`, using the Galaxy launcher client and the fixed `https://embed.gog.com/on_login_success?origin=client` callback. It persists returned token replacements.
- [Heroic GOG user source](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/src/backend/storeManagers/gog/user.ts) obtains profile data from `https://users.gog.com/users/{user_id}`.
- [Heroic library source](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/src/backend/storeManagers/gog/library.ts) retrieves `https://galaxy-library.gog.com/users/{user_id}/releases` with `page_token`/`next_page_token` and filters `platform_id` to `gog`. [Its types](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/src/common/types/gog.ts) include `external_id` and `owned`.
- [Heroic game source](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/src/backend/storeManagers/gog/games.ts) reads `time_sum` from `GET https://gameplay.gog.com/games/{productId}/users/{userId}/sessions` and achievement `items` from `GET https://gameplay.gog.com/clients/{productId}/users/{userId}/achievements` using a bearer token. This is implementation evidence, not a documented service guarantee or a live GameNode verification.

## Goals / Non-Goals

**Goals:** reuse the existing connection and synchronization lifecycle, keep provider parsing at the GOG boundary, and preserve account isolation and complete-result semantics across all three requested features.

**Non-Goals:** a new provider framework, a separate GOG queue, a dedicated service account, a new achievement database model or changes to other stores' behavior. Product ID and SDK client ID are not interchangeable by guesswork.

## Decisions

### D1. One GOG module following existing adapters

Add `src/sync/gog/` with `gog-oauth.ts`, `gog-connection-auth.provider.ts`, `auth/gog-sync-auth.service.ts`, `gog-sync.service.ts`, `gog-sync.types.ts` and `gog-sync.module.ts`. Import/export it through `ConnectionsModule`, `ImporterModule`, `PlaytimeWatchModule` and `GameAchievementModule`, following the existing module graph and `forwardRef` conventions where necessary.

Add `EConnectionType.GOG` and `EImporterSource.GOG`; map them to the existing playtime source in both directions. Register all four capability flags as true and register the three handlers where their counterparts live. Add the GOG job name and source validation to the existing achievement queue/processor.

Alternative: generalize every registration and job dispatch now. Rejected because GOG only needs another provider entry and the existing seams already work.

### D2. Fixed GOG callback pasted into the existing delegated flow

`auth/init` returns the GOG login URL and GameNode state. Use the Galaxy launcher client constants evidenced by gogdl, `response_type=code`, its fixed callback and GOG login layout. Keep these protocol constants together; no new environment overrides or application registration are planned. The existing credential encryption key is required as today.

The user copies the final login-success URL into `callbackParams.code`. Parse with the platform URL parser and require HTTPS, exactly `embed.gog.com`, the fixed path, `origin=client`, no URL credentials or nonstandard port, and exactly one nonempty bounded `code` value. Never request the pasted URL. Accepting arbitrary callback hosts, raw tokens or additional input formats is unnecessary.

The existing GameNode state remains bound to user, provider, preferences and its ten-minute lifetime; consume it before exchange as the shared service does today. This is the existing delegated flow: do not claim GOG echoes or verifies GameNode's state or supports PKCE without evidence.

Exchange the code at the fixed token endpoint, validate access/refresh tokens, finite positive expiry and string account ID, then fetch and validate the profile identity and username. Reject inconsistent IDs. Return only the identity and `PlaintextConnectionCredentials` for the existing transactional persistence. Use a generic safe failure message; never log an Axios error/config or full token URL because GOG's token query includes sensitive values.

Alternative: redirect to a new GameNode OAuth callback. Rejected because the evidenced launcher client has a fixed GOG redirect and the project already supports pasting delegated credentials.

### D3. Refresh under the existing per-connection lock

Follow Epic's rotating-token lifecycle: reuse access tokens with the existing five-minute freshness margin; acquire, renew and ownership-check a `gog-token-refresh-lock:<connectionId>` lock using `connection-token-lock.ts`; reread credentials inside the lock; request refresh through `uncancellableProviderCall`; persist the replacement access token, expiry and refresh token before releasing the lock in `finally`. Preserve the current refresh token if a valid response omits a replacement, and do not invent a refresh-token expiry.

A missing refresh token or a verified invalid-grant response triggers `markReauthRequired` in a transaction. Preserve credentials/status on timeouts, 429, 5xx or malformed replies. Account-scope player and refresh requests under `gog:user:<accountId>`; check refresh identity against the connected account when the response carries it. A failed lock ownership check must prevent persistence.

Alternative: Nintendo's lock-free refresh. Rejected because GOG returns refreshed session credentials and concurrent replacement must not lose a usable grant.

### D4. Complete library, existing mappings and optional curation titles

Fetch the Galaxy releases endpoint through `cancellableProviderCall` with finite HTTP timeouts. Validate the page envelope and continuation metadata, reject any repeated token (including multi-token cycles), and validate required release fields before filtering `owned === true && platform_id === "gog"`. Keep GOG IDs as strings and reject unsafe numeric IDs rather than rounding them. Complete all pages before exposing a library snapshot. Decorate the library method with `@PlayerLibrarySnapshot()` so importer and playtime stages reuse it within one attempt.

Match distinct product IDs through `matchUnprocessed` with category `Gog` and PC platform ID `6`. The existing IGDB and curated mappings need no transformation or new category. Register unmatched IDs with the existing owner tracking; fetch product metadata only for missing curation names using the fixed GOG products endpoint already used in Heroic. A failed optional name lookup leaves the entry unnamed. Do not infer games from their titles. Confirmed non-game metadata can be excluded; unavailable metadata must not fabricate a type or suppress registration.

Expose `Gog` in the MCP category allowlist. Reuse existing store-name helpers and add the missing icon-map entry. Do not invent a store URL from a numeric product ID.

Alternative: Galaxy's cross-store library import or another GameNode category. Rejected because the requested source is GOG and its IGDB mapping category already exists.

### D5. Cumulative playtime and achievement eligibility are independent

Fetch sessions for mapped owned products using the evidenced GOG product ID route. Validate the finite nonnegative cumulative `time_sum` and convert its verified unit once to seconds. The expected unit is minutes, but the real-account check must confirm this against a known game before enabling imports. Missing fields or ambiguous status codes are failures, never a zero default.

Follow the existing playtime processor's ownership guards, progress reporting and writes with `UserPlaytimeSource.GOG` and platform `6`. Prepare and validate the required snapshot before writing the stage; do not use partial retrieval as a complete stage. Preserve stored dates/counts when GOG does not supply verified equivalents. Do not synthesize first/last play dates from sync time. If cumulative total is the only activity signal, use its change as the achievement activity fingerprint and keep initial/reconciliation scheduling active independently.

Select eligible achievement jobs for every mapped library game, including zero-time games. Use existing freshness and seven-day reconciliation admission rather than fetching every game's achievements on every run. Per-game requests remain within the shared concurrency budget and attempt deadline; no unbounded `Promise.all` over a library.

Alternative: only check achievements after a positive playtime delta. Rejected because GOG can report unlocks without a new recorded session.

### D6. One account-specific achievement response supplies both views

Add a GOG achievements fetcher keyed by `(accountId, productId, locale)` that validates and completes the endpoint result. Use the existing attempt-local snapshot decorator so concurrent catalogue/progress consumers share the in-flight response. Validate the continuation fields and reported totals; if a response indicates truncation without usable continuation, fail incomplete instead of inventing parameters or assuming a fixed first-page limit.

Use string `achievement_id` as the external ID for both DTOs, provider name/description/icon for definitions, and a validated non-null `date_unlocked` for obtained results. Exact field and timestamp representations must be captured in sanitized fixtures during the contract check. Do not substitute sync time for malformed dates. Preserve locked/hidden definitions needed for the completion denominator; do not invent missing names, achievements, unlocks or a platinum trophy. Return provider names and descriptions unchanged regardless of `visible` in catalogue reads and synchronization.

`GameObtainedAchievementService` resolves the syncing user's GOG connection and registers its handler. Extend `findAllByExternalGameIdForSync` with the syncing user ID and pass it from the existing worker; its GOG branch resolves the same account and calls the shared fetcher. Keep existing provider behavior and update their constructor/test call sites. Add `Gog` to `GAME_ACHIEVEMENT_ENABLED_SOURCES` and `ACHIEVEMENT_CONNECTION_SOURCE`.

Public catalogue methods keep their existing API. Like Xbox's existing catalogue-auth selection, the GOG auth service can select a usable connected account for a definition lookup; it must only project catalogue fields from the response. It must never return that account's ID, tokens or unlock state. With no usable account, report unavailable instead of caching an empty result. Account-specific snapshots never go in a shared product-only cache.

Reuse the existing worker's atomic obtained/completion/activity commit and retryable publication. A complete empty set and a verified unsupported game use existing terminal outcomes; a generic 403/404, missing data, bad timestamp or identity mismatch must not masquerade as unsupported.

Alternative: a separate achievement pipeline, or silently omitting GOG definitions. Rejected because the user requested full achievement support and the shared worker already owns the required consistency.

### D7. Complete the additive contract surfaces

Update notification DTO provider enums and re-auth preview name, source conversions, registry tests/counts, injection mocks and module fixtures. Extend existing focused importer/playtime/achievement tests with GOG fixtures instead of introducing another test harness. Include proof of account isolation, failed-page preservation, concurrent refresh and idempotent completion/activity behavior.

Update `docs/connection-federated-auth.md` and `docs/player-data-imports.md`; regenerate `server_swagger.json`. Produce `handoff-clients.md` with the `gog` source, paste-the-final-URL instructions for desktop/mobile, re-authentication UX, discovery flags and achievement source metadata. UI implementation lives outside this server change.

## Risks / Trade-offs

- [Unofficial endpoints and launcher client] → Keep constants and validation in the GOG adapter, document the source evidence and validate a real account before rollout. Source code from another client is not proof of payload stability.
- [Unverified units, unlock dates and unsupported error payloads] → The first implementation task captures minimal redacted fixtures and confirms a known game's time/achievement counts. Do not ship guessed conversions or classify all 404s as no achievements. If product IDs do not work for a title, report the specific gap before adding an unplanned SDK-client resolver or reducing scope.
- [Per-game API cost] → Reuse attempt snapshots and existing freshness/ownership controls, budget every request, and reconcile selectively. Large accounts can require more than one bounded attempt.
- [Limited GOG activity] → Only activity already synchronized to GOG can be imported. DRM-free/offline play that GOG never recorded is unavailable.
- [Catalogue uses a connected account] → Strip user fields at the adapter-to-catalogue boundary, preserve provider definition text regardless of visibility, test that unlocks never cross accounts, and fail unavailable when credentials cannot be obtained.
- [Credential query strings] → Never serialize token-request errors or URLs into logs, API errors, metrics or fixtures; keep only safe operation/status/error-code diagnostics.

## Migration Plan

1. Implement and validate the fixed contracts and focused tests, then wire all capability flags and handlers together. Do not advertise achievement support before both catalogue and obtained paths work.
2. Run typecheck/build and affected Jest suites, verify worker dependency injection, regenerate the API document and complete a controlled real-account smoke covering linking, import, playtime, unlocks and reconnect.
3. Deploy as an additive provider. No backfill or database migration is expected; confirm current column definitions while implementing.
4. Roll back by removing GOG registration/handlers and stopping queued GOG work through existing provider validation. Retain encrypted connections and imported user data; do not delete games, playtime or achievements as rollback cleanup.
