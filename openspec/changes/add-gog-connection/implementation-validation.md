# Implementation validation — 2026-11-03

The user authorized implementing against the available evidence while keeping
real-account validation and rollout pending. Task 6.3 remains unchecked.

## Completed checks

- `yarn test:typecheck` and `yarn build` passed on Node 24.
- The affected Jest run passed **667 tests in 73 suites**, with no skipped tests.
  It covered GOG, connections, importer, playtime, achievements, external-game
  curation, notifications, MCP, player state/attempts and provider budgets.
- The run used disposable MySQL on port 14306 and Redis on ports 14379/16379.
  Notification transport used the existing compose-managed Redis with append-only
  persistence; application databases and Redis were not test targets.
- GOG cases exercise token/profile fixture validation, fixed callback validation,
  single-use state, concurrent refresh/rotation/missing replacement, lost locks,
  invalid grants, account mismatch, paginated library completeness/cursor cycles,
  throttling/cancellation/deadlines, metadata fallback, cumulative time, account
  isolation, hidden/invalid/truncated achievements, zero-time scheduling, job
  identity, persisted reads, notification transitions and transaction retries.
- The existing achievement transaction suite now also runs with GOG, covering
  atomic writes, idempotency, empty results, rollback and recoverable publication.
  Existing completion-status tests cover preservation of completed timestamps.
- `server_swagger.json` was regenerated through `SwaggerModule.createDocument`
  using the full Nest dependency graph against isolated services, before app
  initialization/listen. All 155 existing paths were retained; GOG enum values
  are present in connection/importer/notification schemas. No live credentials
  are included. Background auth/schema and queue-close diagnostics on the empty
  fixture app were not treated as a live application smoke test.
- ESLint passed for the new GOG files using the repository's legacy configuration
  (`ESLINT_USE_FLAT_CONFIG=false`). `git diff --check` and strict OpenSpec validation
  passed. No dependencies, environment variables or migrations were added;
  connection/importer/playtime source columns already store strings.

Three old integration fixtures were corrected after enabling the wider checks:
refresh locks now exercise the extracted shared helpers, the Xbox fixture supplies
its unmapped-registration mock, and onboarding freezes JavaScript time along with
its mocked database clock. The new GOG module uses the existing `forwardRef`
convention across the connection/worker graph.

## Pending live acceptance (task 6.3)

No new live account requests were performed during implementation. Earlier
redacted captures establish token/profile/library and zero-time/empty-achievement
shapes; synthetic unit-test data is not additional live evidence.

Still required: linking/reconnect and manual/automatic import through a running
application, a known nonzero cumulative time, actual locked/unlocked/hidden
achievements, repeat/completion sync, achievement continuation and definitive
unsupported responses. Product-to-SDK-client identity across achievement-enabled
titles also remains unverified.

The adapter fails truncated or ambiguous results without overwriting existing
progress. In particular it does not guess achievement pagination parameters or
classify generic 403/404 responses as unsupported. Rollout remains pending the
live acceptance evidence; see `contract-evidence.md` and `handoff-clients.md`.
