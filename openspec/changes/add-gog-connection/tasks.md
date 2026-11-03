# Tasks

## 1. GOG adapter contracts

- [x] 1.1 Confirm the specific GOG contracts documented in design D2/D4/D5/D6: login-success URL, token/profile identity, releases pagination, `time_sum` unit, achievement IDs/unlock-date format, continuation and verified unsupported/invalid-grant responses. Deliver minimal redacted fixtures and evidence from a controlled account or primary client source; keep missing live evidence explicit and do not substitute guessed success/unsupported behavior.
- [x] 1.2 Add `src/sync/gog/` protocol constants, token helper and response types without a new dependency or configuration knob; verify fixture parsing rejects unsafe IDs, invalid expiries and malformed payloads, and that errors/logs contain no token query values. Document verified endpoint assumptions beside the fixtures or adapter documentation.

## 2. Connection and credential lifecycle

- [x] 2.1 Add `GOG` to connection discovery and implement its delegated-code auth provider using the existing state/persistence flow; verify valid linking plus wrong host/path/origin, URL credentials, duplicate/missing code, expired/replayed/wrong-user state, failed exchange and profile-ID mismatch with focused provider and connection tests.
- [x] 2.2 Implement GOG access-token reuse and locked refresh with the existing crypto, token-lock and re-auth helpers; verify concurrent refresh, rotated/missing replacement token, lost lock, revoked/missing grant, transient errors, account mismatch and one notification per re-auth transition in focused tests.
- [x] 2.3 Wire the GOG auth module/provider through `ConnectionsModule`, add notification provider values and the `GOG` display name, and update constructor mocks/module fixtures; verify discovery flags, safe connection DTOs, settings/deletion behavior and the connection/notification tests. Update the GOG linking and credential-lifecycle sections of `docs/connection-federated-auth.md`.

## 3. Owned library and curation

- [x] 3.1 Implement account-scoped complete releases retrieval and attempt-local library snapshot reuse; verify multi-page and empty libraries, mixed-platform/unowned filtering, unplayed games, duplicate IDs, malformed pages, cursor cycles, cancellation, deadlines and 429 isolation with GOG sync-service tests.
- [x] 3.2 Add the GOG importer handler, importer source and both source conversions, using existing `Gog` mappings and PC platform `6`; verify processed/ignored/includeMarked behavior, manual import and automatic collection import through focused importer tests, including no import from a failed later page.
- [x] 3.3 Register unmatched GOG IDs with owners and optional product titles using existing curation behavior; add `Gog` to the MCP category filter and GOG to the external-game icon map. Verify name-lookup failure, repeated/dismissed registrations, MCP authorization/filtering and `agent` mapping conflict handling in existing suites; document GOG library and mapping behavior in `docs/player-data-imports.md`.

## 4. Playtime and achievement eligibility

- [x] 4.1 Implement validated cumulative GOG playtime retrieval with the verified unit conversion, account budget and timeout behavior; verify zero versus missing values, malformed totals, unavailable games and request failures in adapter tests without overwriting existing values.
- [x] 4.2 Register the GOG playtime handler and both conversions for the existing `UserPlaytimeSource.GOG`, wire its module and update affected mocks; verify PC source identity, unchanged totals, no duplicate time, preserved dates/counts and stale-owner write rejection in playtime/player-sync tests. Document the limits of GOG-recorded activity in `docs/player-data-imports.md`.
- [x] 4.3 Select eligible GOG achievement jobs for mapped library games independently of positive playtime; verify initial zero-time coverage, changed-total fingerprints, retry admission and seven-day reconciliation without unbounded calls in playtime/player-sync tests.

## 5. Achievement definitions, unlocks and completion

- [x] 5.1 Implement a complete GOG achievement snapshot shared per account/product/locale within an attempt; verify definitions and unlocks use the same `achievement_id`, valid versus null/invalid dates, full pagination, truncation without continuation, hidden definitions and verified empty/unsupported versus ambiguous error results with focused GOG adapter tests.
- [x] 5.2 Add GOG catalogue handling to `GameAchievementService` and obtained handling to the provider registry; pass user context from the worker to the catalogue sync method and update all callers/mocks. Verify one shared fetch, catalogue field projection, no usable catalogue account, two-account isolation and unchanged Steam/PSN/Xbox behavior in service tests; document GOG achievement responses and authentication requirements.
- [x] 5.3 Enable the existing `Gog` category in achievement source lists, add GOG queue job selection and worker identity validation, and wire the module; verify queue admission, wrong/stale owners, source grouping/icon and read-triggered refresh through queue/processor/module tests.
- [x] 5.4 Extend the existing achievement transaction integration tests with GOG cases proving atomic obtained/completion/activity results, idempotent retries, preserved completion timestamps, unsupported/empty outcomes, late-page failure and recoverable publication; verify no fabricated platinum state or cross-provider achievement associations.

## 6. Client contract and integrated validation

- [x] 6.1 Regenerate `server_swagger.json` and deliver `handoff-clients.md` with `gog` enums/flags, final-URL paste instructions for desktop/mobile, reconnect behavior and GOG achievement groups; verify examples match actual init/callback and read DTOs, with no credential values in generated artifacts.
- [x] 6.2 Run `yarn test:typecheck`, `yarn build` and affected Jest suites for GOG, connections, importer, playtime, game achievements, notifications and MCP; verify worker dependency injection and fix any constructor fixtures or expectations changed by the new provider.
- [ ] 6.3 Complete a controlled GOG-account smoke test covering linking, manual/automatic library import including an unplayed game, a known cumulative time, locked/unlocked achievements, completion/repeat sync and reconnect; record redacted outcomes and any unavailable live checks. Confirm no schema migration or new environment variable is needed, and keep rollout pending until units, identities and payloads are verified.
