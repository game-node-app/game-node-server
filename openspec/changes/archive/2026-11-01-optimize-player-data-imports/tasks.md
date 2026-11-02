# Tasks

Implement the groups in dependency order. Each checkbox includes its own acceptance check; broader integration checks are intentionally separate. Use the installed Nest/BullMQ/TypeORM stack and existing project conventions. Do not introduce billing, paid tiers, additional providers, a generic sync engine, or destructive history cleanup. All commands below run from the repository root. Retain `psn-api` without transport replacement, patching, or interception. Exclude PSN in-flight cancellation/hard duration guarantees and hidden HTTP status/header/Retry-After preservation; retain pagination guards, observable errors, bounded retries, and ownership checks.

## Review follow-up — 2026-10-25

The 108 existing tasks are checked, including review follow-ups 15.1–15.5. Follow-up 15.6 is pending and not implemented or tested. Earlier verification passed: 333 tests in 52 scoped suites with disposable MySQL/Redis and no skips, `yarn build`, strict OpenSpec validation, and whitespace checks. The Xbox 5,000-title service-cap follow-up has not been test-run. Live providers, frontend compatibility, and production load remain rollout checks.

- [x] 15.1 Normalize confirmed-zero owned/recent Steam responses before SDK parsing; test the installed SDK with omitted arrays, ambiguous/contradictory responses, and transport failures.
- [x] 15.2 Expire known Xbox recent totals when statistics are absent or valueless; verify cumulative totals, dates, counts, and history remain unchanged and unseen games are not initialized to zero.
- [x] 15.3 Share the Steam schema within one achievement attempt; verify one cold provider schema call for concurrent consumers and retry after failure.
- [x] 15.4 Build discovery candidates once, sort once, and process bounded pages; verify a 1,001-game run loads each full processed/ignored list once, respects changed user choices, and preserves HTTP contracts.
- [x] 15.5 Process at most the first 5,000 structurally valid Xbox TitleHub titles and count that bounded snapshot as complete under the service policy, even when unverified metadata signals more titles. Cache the bounded array and advance normal success timestamps; preserve existing local rows and fail only when the titles array is missing.
- [ ] 15.6 Fetch played Steam Family licenses through generic `client.get(path, params)` with `include_family_licenses=true`; normalize the raw response to the existing library item shape, preserve recent-result precedence, and distinguish family rows from owned `game_count`. Verify parameter forwarding, missing `rtime_last_played`, family-only zero counts, explicit empty arrays, and omitted-array failures.

## Historical implementation checkpoint — 2026-10-25

64 of 103 tasks are complete: sections 1–8 and tasks 9.1–9.3. Tasks 9.4–9.9 and sections 10–14 remain unchecked; this change is not ready for rollout or archival.

Task 9.3 now wraps history and current-row writes in the existing TypeORM transaction boundary. Its disposable-MySQL regression injects a current-row failure after history insertion, confirms both writes roll back, then confirms retry and an identical observation leave one row in each table. The fixture also exposed and fixed BIGINT ID string/number checksum differences.

Focused verification for this checkpoint passed: playtime service unit tests (7/7), the disposable-MySQL transaction test (1/1), and `git diff --check`. A fresh build, broader cross-capability acceptance, and live-provider checks remain pending.

## 1. Repair effective queue options and recurring job lifecycle

- [x] 1.1 Add focused tests under `src/importer/importer-watch` and `src/game/game-achievement/sync` that inspect effective Nest queue options, including local/global `defaultJobOptions` composition. Verify the tests reproduce missing retention on the current implementation rather than testing only a handwritten options object.
- [x] 1.2 Define explicit bounded completed/failed retention in the importer and achievement queue registrations, using the design's one-hour/1,000 completed and seven-day/1,000 failed bounds. Verify effective options retain attempts/backoff and no longer inherit removal accidentally.
- [x] 1.3 Replace the importer's permanent reusable job identity with distinct run identity plus pending-work deduplication compatible with retained history. Verify a second eligible run executes after the first completes and that concurrent identical admissions produce one active unit of work.
- [x] 1.4 Return/await queue writes from `PlaytimeWatchService.registerJob` and achievement enqueue methods, updating scheduler, WebSocket, and connection-service callers. Verify rejected Redis writes are observable to callers and are not reported as accepted work.
- [x] 1.5 Remove the hard-coded PSN enqueue from `GameAchievementSyncQueueService` construction. Verify module/service construction and repeated startup schedule no account-specific job.
- [x] 1.6 Add a scoped Redis integration regression for completed importer jobs, waiting-job duplicates, and bounded retained failures. Verify removal/retention cannot permanently block the next run; do not flush unrelated queues in setup or cleanup.
- [x] 1.7 Start `docs/player-data-imports.md` with queue ownership, effective retention, and a targeted legacy-job cleanup procedure. Verify the procedure selects only the intended queue, job name, and terminal states and explicitly preserves active/waiting work.

## 2. Fix provider pagination and batch termination

- [x] 2.1 Fix `XboxSyncService.getBatchMinutesPlayed` slicing to use non-overlapping batches of at most 1,000 title IDs. Verify fixture cases of 0, 1, 999, 1,000, 1,001, and 2,001 titles produce exact batch sizes with no omissions or duplicate requests.
- [x] 2.2 Advance Xbox batch position after a successful empty statistics response and classify malformed responses separately from valid empty ones. Verify absent/empty collections terminate or advance predictably with a bounded request count.
- [x] 2.3 Replace PSN trophy-title offset arithmetic with an explicit supported limit and progress based on actual results/continuation semantics. Verify totals below one page, exactly one page, just over one page, and 1,600 titles never repeat offset 800 or skip intermediate pages.
- [x] 2.4 Add repeated-offset/token and zero-progress guards to PSN played-game and trophy-title pagination. Verify malformed totals, repeated pages, empty terminal pages, and changing totals terminate with either complete success or explicit incomplete failure.
- [x] 2.5 Implement verified continuation handling for Xbox obtained-achievement responses and PSN trophy-detail responses instead of treating maxItems as completeness. For the current Xbox TitleHub library endpoint, retain explicit `maxItems: 5000`, do not invent pagination parameters, and treat the first 5,000 structurally valid titles as a complete service snapshot even when unverified metadata signals more results. Malformed responses remain incomplete failures. Verify multi-page achievement/trophy fixtures return all distinct items and repeated continuation tokens fail finitely; verify capped and below-cap TitleHub results are successful and absent titles do not delete local data.
- [x] 2.6 Preserve the Steam owned/recent merge and recent-result precedence while consolidating duplicate app IDs. Verify Family Sharing-only entries, missing timestamps, duplicate editions, and a private/failed required endpoint retain the documented fallback behavior without false completeness.
- [x] 2.7 Document endpoint limits actually used and pagination termination rules in `docs/player-data-imports.md`. Verify limits against installed client behavior or primary provider/client documentation and clearly mark any unverified provider restriction. Document the TitleHub 5,000-title service cap, successful bounded snapshot handling, preservation of local rows, and the requirement to verify supported continuation before adding pagination.

## 3. Preserve complete snapshots and classify provider failures

- [x] 3.1 Make provider result handling distinguish complete, empty, unsupported, private/unavailable, throttled, and failed/incomplete outcomes with the smallest local result/error changes. Classify PSN only from evidence exposed by the retained library; ambiguous errors remain failed/incomplete. Verify each observable outcome has a fixture and no consumer mistakes partial data for a complete empty library.
- [x] 3.2 Remove catch-and-return-partial success behavior from PSN library/title fetchers. Verify a failure on page two does not advance success or replace/cache earlier complete data.
- [x] 3.3 Update affected `@Cacheable` callers or the minimal necessary decorator behavior so complete results are cached as success and incomplete results retain their failure status. Verify empty successful results and bounded Xbox service snapshots can be cached, failures are not cached as arrays, and unrelated cached services retain their behavior.
- [x] 3.4 Bound cancellable provider leaf requests and connection-attempt progression using the design's initial 30-second and ten-minute limits. Exclude in-flight PSN cancellation, hard duration bounds, and transport-resource release; check deadlines between PSN calls and before persistence. Verify cancellable hung requests terminate, overlong sequences stop, late PSN results cannot commit, and retryable state remains.
- [x] 3.5 Preserve provider status/cause and Retry-After when exposed through existing HTTP wrappers, including Xbox `callXboxAPI`. Keep PSN on `psn-api`, preserve only errors/metadata it exposes, and document excluded hidden HTTP status/header/Retry-After guarantees. Verify 429, authentication/privacy failures, network failures, unsupported achievements, and valid zero results are classified without leaking credentials.
- [x] 3.6 Implement a shared Redis-backed provider cooldown for observable throttling and a conservative shared outbound concurrency bound across the affected workers. Verify two worker instances respect one injected 429 delay, permits recover after interruption, and nested orchestration does not deadlock leaf-call admission.
- [x] 3.7 Keep retry counts bounded and prevent permanent unsupported outcomes or normal empty libraries from consuming transient retry attempts. Verify transient failure recovers on a later attempt and repeated permanent outcomes do not form a retry storm.
- [x] 3.8 Document provider failure semantics, cancellation limits of installed clients, and the absence of measured quota guarantees. Verify documentation matches tested outcomes and does not present worker job limits as provider request quotas.

## 4. Add durable account and per-game synchronization state

- [x] 4.1 Add the minimal TypeORM state for connection-scoped success/due times, stage outcomes, retry timing, owner token/lease, and source-account identity. Verify a migration round trip on disposable MySQL and indexed due queries without loading all libraries.
- [x] 4.2 Add per-account/external-game state for successful checked time, empty/unsupported outcome, activity fingerprint, retry eligibility, and seven-day reconciliation due time. Verify a successful zero-achievement game has state without an obtained-achievement row.
- [x] 4.3 Register new entities/repositories in affected existing modules and datasource discovery paths. Verify `yarn build` and a test application resolve dependencies without introducing new forward-reference cycles or modifying unrelated IGDB/search behavior.
- [x] 4.4 Implement atomic admission and owner-checked completion with expiring recovery and bounded lease renewal where an attempt can outlive the admission lease. Verify two competing database transactions admit one owner and a stale owner cannot commit over a successor.
- [x] 4.5 Handle the admission-to-enqueue gap through compensation and lease recovery rather than assuming database/Redis atomicity. Verify queue rejection, process death before enqueue, and enqueue success with lost acknowledgement all recover without duplicate current work.
- [x] 4.6 Bind state/jobs to connection ID and source account; update connection replacement/deletion cleanup and worker precommit checks. Verify old-account work cannot write after reconnect, settings-only updates preserve cooldown, and deletion removes or invalidates scoped state safely.
- [x] 4.7 Add deterministic spread for existing-account bootstrap and conservative initial per-game reconciliation. Verify a large fixed fixture spans the 24-hour window reproducibly and existing obtained rows are not treated as proof of complete synchronization.
- [x] 4.8 Document the state schema, migration rollback prerequisites, and bootstrap limitations. Verify migrations preserve imported achievements/history and do not mass-publish old activities.

## 5. Replace population scans with daily due-work scheduling

- [x] 5.1 Replace four full scans per day and restart-relative importer scheduling with a lightweight due-work tick using the design's initial five-minute tick and 100-row page size. Verify fake-clock tests at just before and exactly at eligibility and ensure no full library population read occurs.
- [x] 5.2 Keep full-refresh interval selection in one daily policy boundary shared by automatic/manual scheduling, without implementing tiers or payment checks. Verify all current users receive a 24-hour success interval and failure retries do not fabricate a successful refresh.
- [x] 5.3 Preserve immediate new-account onboarding while preventing repeated settings saves from resetting cooldown. Verify new link, reconnect with a different source account, unchanged source account, and simultaneous manual/scheduler requests.
- [x] 5.4 Page due work with stable ordering/cursors and distribute jobs across eligible connections fairly. Verify thousands of due fixtures are processed without duplicate pages, unbounded query parameters, or starvation after a failed enqueue.
- [x] 5.5 Reuse a provider-library result and its completeness status for due playtime/discovery consumers in the same execution where possible; retain independent stage success markers. Verify one stage can retry after the other succeeds without repeating successful writes or marking both failed.
- [x] 5.6 Expose accepted/pending/cooldown/failure/last-success/next-eligible status through the existing synchronization surface with owner authorization. Verify WebSocket refresh receives truthful status on queue failure and unauthorized users cannot inspect another account's private sync state.
- [x] 5.7 Add restart and two-instance scheduling integration tests using real Redis/MySQL and a controlled clock. Verify one eligible attempt, recovered expired admissions, and a second successful daily cycle.
- [x] 5.8 Update `docs/player-data-imports.md` with daily freshness expectations, scheduler tick versus product cadence, immediate onboarding, and later premium-policy/TTL considerations. Verify no documentation claims premium cadence is implemented.

## 6. Select and deduplicate achievement work

- [x] 6.1 Replace unconditional per-playtime-entry enqueue calls with selection from initial state, changed activity/progress, due failures, and seven-day reconciliation. Verify an unchanged recently synchronized library generates no achievement jobs and a due inactive game does.
- [x] 6.2 Derive Steam change signals from cumulative/recent data without requiring reliable lastPlayedTimestamp, and apply recent-list precedence before selection. Verify absent timestamps and Family Sharing games still receive initial and reconciliation imports.
- [x] 6.3 Use PSN title progress/update signals and retain distinct mappings by `(npCommunicationId, npServiceName)` in both available and obtained trophy fetchers. Verify two communication IDs sharing one service name both contribute data without duplicate trophy identities.
- [x] 6.4 Select Xbox achievements independently of the MinutesPlayed statistics loop, using title/progress identity even when statistics are absent. Verify a title with achievements but no playtime value still synchronizes.
- [x] 6.5 Await verified PSN mapping persistence before enqueue, and reject ambiguous name-only associations rather than selecting the first match. Verify duplicate display names across concepts/platforms stay unresolved and one verified concept association imports the correct sets.
- [x] 6.6 Add active-work deduplication for connection/account/user/external game and compact payloads containing identity plus selection reason. Verify different editions/providers remain distinct where required, PSN platform loops do not duplicate one external-game refresh, and queue rejection reaches the parent.
- [x] 6.7 Persist successful empty/unsupported results, failed attempts, and reconciliation eligibility accurately. Verify empty games do not re-enter initial sync daily, failures retry, and changed mappings/catalogues can invalidate the relevant state without rescanning all users immediately.
- [x] 6.8 Replace the commented old-game skip and temporary unconditional backfill behavior with explicit state-driven reconciliation. Verify a frozen-clock seven-day test discovers a late achievement without additional played time.
- [x] 6.9 Document selection reasons and reconciliation delay, including the difference between successful empty and unknown. Verify examples cover initial import, active change, failed retry, and inactive reconciliation.

## 7. Reuse snapshots and persist achievement results atomically

- [x] 7.1 Refactor obtained/completion/activity orchestration so a game execution fetches each required obtained and catalogue snapshot once. Verify spies count one logical fetch per needed snapshot and all derived results receive the same inputs.
- [x] 7.2 Split provider-backed reads from pure completion/platinum calculations and persisted reads, preserving existing validation and supported-source rules. Verify pure calculations work without network access and unsupported external categories fail consistently.
- [x] 7.3 Persist new obtained rows, completion changes, local activity records, and successful game state in one local transaction after complete provider fetches. Verify injected failures at each write roll back all related changes and provider I/O occurs outside the transaction.
- [x] 7.4 Serialize conflicting user/external-game commits and retain unique achievement identities. Verify simultaneous attempts with overlapping newly obtained achievements create one set of rows and one corresponding activity without losing a successful retry.
- [x] 7.5 Preserve existing completion dates on unchanged completed state and recalculate from complete mapping sets only. Verify partial responses cannot falsely uncomplete a game, unchanged reconciliation preserves completedAt, and real completion transitions follow the documented rule.
- [x] 7.6 Remove redundant catalogue/obtained fetches from status/activity helpers and avoid presentation-only rarity requests on the completion path when unnecessary. Verify display DTOs retain their existing rarity/localization fields through their display path.
- [x] 7.7 Add focused transaction integration fixtures for new achievements, zero results, existing achievements, no catalogue, changed catalogue, and multiple PSN sets. Verify no-success/no-activity behavior is deliberate in each case rather than caused by an early return.
- [x] 7.8 Document transaction boundaries, idempotency identities, and completion timestamp behavior. Verify the failure/retry examples correspond to integration fixtures.

## 8. Recover committed activities and prevent duplicate feed entries

- [x] 8.1 Reuse an existing durable publication mechanism if it already covers the commit/enqueue gap; otherwise add the minimal pending-delivery marker to local achievement activities and its migration. Verify pending delivery is committed atomically with the local activity.
- [x] 8.2 Publish committed pending activities through the existing activity queue using deterministic source identity, clearing pending state only after confirmed enqueue. Verify queue rejection leaves a deliverable activity and does not roll back already committed achievements.
- [x] 8.3 Add bounded pending-delivery recovery to an existing worker/tick path, independent of obtaining another new achievement. Verify a crash immediately after local commit is recovered after restart without refetching provider data.
- [x] 8.4 Make downstream activity handling idempotent by source identity, preserving current error handling and validation. Verify enqueue acknowledgement loss and worker retry produce one feed activity and no lost delivery.
- [x] 8.5 Define a conservative bootstrap cutoff for legacy activity records and test it. Verify migration does not republish every historical activity and does not suppress newly committed pending records.
- [x] 8.6 Document pending-delivery diagnosis, replay scope, and safe retry behavior in `docs/player-data-imports.md`. Verify the procedure targets a source record and does not repeat obtained-row insertion.

## 9. Make playtime observations and period accounting consistent

- [x] 9.1 Correct checksum age direction and canonicalize the compared values actually persisted, separating derived rolling totals from provider-change detection. Verify unchanged records aged 0, 13, 14, and 60 days take the intended path and equivalent representations do not force writes.
- [x] 9.2 Capture one observation timestamp/window per attempt and persist it independently of provider first/last played dates using existing history timestamps where trustworthy. Verify fixtures with old played dates but new observations use observation boundaries.
- [x] 9.3 Persist changed history/current playtime consistently and make retry of the same observation idempotent. Verify failure between history and current-row writes leaves neither a partial pair nor duplicate history on retry.
- [x] 9.4 Replace period MAX-MIN aggregation with trusted baseline plus ordered non-negative increments attributed to interval endpoints. Verify baseline 100 then 160 returns 60, an unknown first sample returns no invented lifetime delta, and multiple boundary samples have deterministic inclusion.
- [x] 9.5 Handle cumulative corrections/resets by starting a new baseline. Verify sequences 100->80->90 and 100->160->120->150 produce only actual post-baseline growth and never negative or MAX-MIN-inflated totals.
- [x] 9.6 Recompute derived PSN/Xbox recent totals when increments expire even with unchanged provider totals; retain Steam-supplied recent semantics. Verify advancing a frozen clock beyond 14 days expires values without requiring a new playtime change.
- [x] 9.7 Preserve PSN authoritative playCount and stop incrementing Steam/Xbox totalPlayCount per detected polling change. Verify once-daily and four-times-daily replay produces identical counts, and legacy counts remain preserved instead of reset.
- [x] 9.8 Add boundary fixtures for identical retries, editions mapping to one internal game, null dates, manual submissions, and corrections at period start/end. Add the missing manual DTO validation for positive safe-integer game/platform IDs, supported sources, integer seconds in the signed INT range, and optional/null valid dates; verify HTTP 400 before persistence, authenticated-session ownership, and source/platform separation.
- [x] 9.9 Document estimated endpoint attribution, unknown first baselines, legacy precision limits, rolling-provider differences, and non-session semantics. Verify migration does not rewrite historical rows or claim exact historical play dates.

## 10. Batch local reads and remove repeated scans

- [x] 10.1 Add a bounded existing-playtime lookup for the connection's relevant user/game/source/platform keys and pass known state through the internal save path. Verify processor/save no longer issue two lookups per game and missing records still insert safely.
- [x] 10.2 Compute derived period aggregates once per shared source/platform window and reuse the result across imported games. Verify SQL-count assertions prevent an all-games history aggregation inside each game's save loop.
- [x] 10.3 Replace repeated nested `find`, `some`, and `includes` scans in touched importer/playtime loops with existing map/set helpers or direct maps. Verify duplicate editions, source ordering, preferred platforms, and unmapped-game registration remain correct.
- [x] 10.4 Batch or deduplicate unmapped-game and mapping lookups where the same snapshot repeats them, retaining validation and uniqueness. Verify concurrent registration is harmless and a mapping write is complete before dependent work proceeds.
- [x] 10.5 Inspect EXPLAIN for actual due-state and observation-baseline queries, then add only necessary indexes in reversible migrations. Verify representative large fixtures use bounded indexed access and no unrelated indexes/schema changes are introduced.
- [x] 10.6 Add a deterministic large-library test with a small changed subset, asserting bounded reads, selected jobs, and unchanged result equivalence. Verify the second warm run eliminates repeated work rather than merely serving stale results from a mocked cache.
- [x] 10.7 Document measured query/call counts and fixture size for the optimized path. Verify jobs, provider leaf calls, cache hits, and database operations are reported separately with no unsupported production-savings percentage.

## 11. Route HTTP and journal consumers through shared freshness admission

- [x] 11.1 Update both achievement controller versions and journal consumers to use persisted obtained reads and controlled background refresh admission. Verify stale data is returned without direct live-provider reads and overlapping routes deduplicate the same game refresh.
- [x] 11.2 Remove asynchronous persistence side effects from GET-oriented obtained-read methods and ensure the worker owns the shared atomic persistence path. Verify a read alone cannot partially persist obtained rows while bypassing completion/activity logic.
- [x] 11.3 Preserve achievement/journal response payloads and add only the required synchronization status contract. Verify successful empty versus unknown/pending is distinguishable through status and anonymous reads do not gain private account state or new mutation authority.
- [x] 11.4 Validate source values, connection ownership, and allowed target identities for manual/targeted admissions while preserving existing public achievement visibility. Verify invalid enum values, disconnected accounts, unauthorized refreshes, and another user's public read follow explicit contracts.
- [x] 11.5 Add contract tests for WebSocket status, v1/v2 obtained reads, journal output, and no-new-games HTTP behavior. Verify existing clients' field shapes and deliberate 404 compatibility remain stable where retained.
- [x] 11.6 Regenerate affected Swagger output through the project's existing workflow and document stale-read/initial-import behavior and cooldown responses. Verify generated output contains only intended contract differences and the frontend compatibility review is recorded as a rollout prerequisite if its source is outside this repository.

## 12. Make discovery, auto-import, and notifications independently recoverable

- [x] 12.1 Return successful empty discovery to the background worker instead of retrying `findUnprocessedEntries` 404 outcomes; keep any required HTTP adapter at the controller boundary. Verify no-new-game scans complete without retries and HTTP compatibility tests pass.
- [x] 12.2 Separate notification filtering from automatic-import eligibility so a notified but failed item remains retryable. Verify a mixed-success run followed by retry imports only remaining items without generating the same discovery notification twice.
- [x] 12.3 Make collection creation and processed-state transitions idempotent, finishing missing transitions for existing entries without resetting user changes. Verify failure after collection creation, concurrent attempts, ignored games, and already-processed games.
- [x] 12.4 Revalidate automatic-import collection ownership/existence at execution and define deleted-collection fallback consistently with existing connection semantics. Verify no cross-user collection write is possible and a changed destination does not overwrite unrelated entries.
- [x] 12.5 Persist committed notification outcomes and recover publication failure using existing notification records/queue facilities, adding only missing minimal state. Verify crash/retry after import commit emits one correct notification and does not repeat imports.
- [x] 12.6 Keep imported/skipped/failed counts accurate per committed outcome and bound discovery processing beyond the current effectively unlimited result request. Verify large fixtures process in pages without losing entries due to mutable processed/notified filters.
- [x] 12.7 Add scoped legacy-recovery fixtures and a runbook entry. Verify historical notified items are not automatically replayed in bulk and processed/ignored user choices are preserved.

## 13. Add operational summaries and safe rollout controls

- [x] 13.1 Emit per-run structured summaries using existing logging/OpenTelemetry for source/outcome, duration, queue age, retries, games seen/selected/skipped/changed, and provider calls. Verify successful, empty, partial, throttled, and failed fixtures emit accurate counts without raw provider payloads or secrets.
- [x] 13.2 Keep metric dimensions bounded to operational categories and place any necessary diagnostic identifiers only in authorized logs/status. Verify user/game IDs are not metric labels and authentication material is redacted on failure paths.
- [x] 13.3 Add documented checks for queue backlog, stale successes, repeated throttling, pending activity/notification delivery, and reconciliation lag. Verify operators can distinguish provider failure from no new games without querying secrets.
- [x] 13.4 Complete the staged deployment and rollback runbook: queue fixes first, additive migrations, spread bootstrap, legacy-job cleanup, worker payload compatibility, and daily activation last. Verify every step has a command or observable condition and no step relies on a global Redis flush or history deletion.
- [x] 13.5 Define mixed-version handling for old jobs/workers and account replacement during rollout. Verify an integration fixture drains or safely rejects old payloads and binary rollback does not allow stale workers to overwrite new account state.
- [x] 13.6 Record cold/warm baseline methodology and provider-quota uncertainties. Verify all performance comparisons preserve equivalent correctness and future premium frequency remains blocked on measurement and TTL review rather than assumed capacity.

## 14. Run cross-capability integration and acceptance checks

- [x] 14.1 Exercise onboarding, one daily refresh, cooldown rejection, process restart, and a second daily refresh across Steam/PSN/Xbox fixture adapters with real MySQL/Redis. Verify persisted status, queue lifecycle, and imported results agree across both cycles.
- [x] 14.2 Run a two-instance race involving scheduler, manual request, and achievement read for the same account/game. Verify bounded provider calls, one current admitted execution, no duplicate local/feed/notification records, and successful expired-owner rejection.
- [x] 14.3 Inject failures at page fetch, queue admission, history save, achievement transaction, post-commit activity delivery, and notification publication. Verify each spec's retry/recovery guarantee without destructive data changes.
- [x] 14.4 Advance the integration clock through 24-hour eligibility, seven-day reconciliation, and 14-day recent-time expiry. Verify inactive/empty games reconcile, delayed achievements appear, and derived recent totals expire without fabricated sessions.
- [x] 14.5 Compare a cold large-library import and a warm mostly unchanged import, including missing timestamps and absent Xbox stats. Verify lower selected work and bounded query/call growth while preserving cumulative totals, achievement identities, and expected freshness.
- [x] 14.6 Run `yarn build`, the focused unit suites added in each group, relevant controller/journal/collection/activity regressions, and the scoped integration suite with its documented setup/cleanup commands. Verify all pass and record any unavailable external-provider checks explicitly.
- [x] 14.7 Run `openspec validate optimize-player-data-imports --strict`, review the implementation diff against all five capability specs, and confirm unrelated IGDB/search work remains intact. Verify every completed checkbox has its stated evidence and the change is ready for review without archiving or activating paid cadence.
