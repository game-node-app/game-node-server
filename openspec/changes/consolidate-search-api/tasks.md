# Tasks

## 1. Compatible API boundary

- [x] 1.1 Add the SearchModule and controller, register neutral and v1 routes with explicit POST 200 responses, and verify all six paths plus unauthenticated CORS/OPTIONS with Supertest under the actual app versioning/middleware configuration.
- [x] 1.2 Add legacy-shaped request/response DTOs and Swagger annotations, using the sibling Go DTOs and client wrapper as read-only contract references; verify generated OpenAPI paths, request field types, optional response fields, and representative flattened payload fixtures without changing sibling files or exports.
- [x] 1.3 Enforce strict known-field types despite global implicit conversion, category/status enums, 256-character strings, 100-entry filters, positive integer pagination with omitted/zero defaults, limit 100, and offset 10000; verify boundary values and invalid bodies return 400 before any engine request and document limits with this module's API documentation.

## 2. Engine requests and response normalization

- [x] 2.1 Implement the shared configured Axios/Nest HTTP engine path with fixed tables/fields and a five-second timeout; verify mocked availability, timeout, explicit engine error, timed_out, and malformed-response cases map to controlled 503/504/502 responses without leaking upstream bodies or credentials and without blocking unrelated API startup.
- [x] 2.2 Implement anchored game-name/alternative-name queries, category/status IN filters, filter-only match-all, and ordered relevance/views/release-date/ID sorting; verify query fixtures, empty query behavior, sort order, and immediate error propagation.
- [x] 2.3 Implement explicit game/user response mapping with legacy field omission, comma-separated labels, source, ISO timestamps, numeric game IDs, and empty arrays; verify sparse rows, epoch release dates, populated counters, and response field allowlists against contract fixtures.
- [x] 2.4 Implement page/limit offsets and total-derived metadata without 16-bit narrowing; verify first/last pages, zero results, empty beyond-end pages, and user hasNextPage with 21 matches. Document intentional pagination corrections.
- [x] 2.5 Implement autocomplete through the shared game path with prefix matching, forced first page/five names, and empty-input short circuit; verify the legacy data/total shape, caller-page override, and empty input without an engine request.
- [x] 2.6 Implement nonblank username prefix search and stable relevance/userId ordering; verify public results contain only userId/username, the profile boolean remains accepted without engine-profile exposure, and game/autocomplete/user service unit checks pass.

## 3. Server-owned Manticore and effective relation filters

- [x] 3.1 Bring the pinned Manticore 7.4.6 config, MySQL sources, matching settings, persistent volume, and development/production service definitions into this repo; add required DB input rendering and MANTICORE_URL documentation. Verify Compose rendering, template escaping/fail-fast input checks, local loopback bindings, and no public production engine ports or hardcoded production credentials.
- [x] 3.2 Add a disposable search MySQL/Manticore fixture harness and minimal test commands, seeding game relations/statistics and public profiles with actual schema names; verify both initial plain indexes build using only this repository and document harness startup/cleanup without affecting other projects' volumes.
- [x] 3.3 Extend game documents with multi-value genre/theme/platform IDs and preserve flattened label fields, LEFT JOIN behavior, and zero-default popularity. Verify sparse and high-fanout fixtures retain games and complete relation membership; check aggregate display strings are not silently truncated.
- [x] 3.4 Resolve bounded legacy string arrays by exact case-insensitive resource names, decimal IDs, and platform abbreviations; apply OR within each field and AND across fields in the engine. Verify all five filter families, mixed known/unknown values, entirely unresolved filters, empty arrays, multi-filter totals, and no post-pagination filtering.
- [x] 3.5 Preserve the image's initial/periodic rebuild mechanism, UTC game/user schedules, and one indexing owner; add minimal locking only if the pinned runner does not already serialize builds. Verify manual and scheduled commands share nonoverlap protection, two API replicas do not duplicate rebuilds, and document the exact operational commands.
- [x] 3.6 Verify rotation preserves searchable last-good indexes when source access fails, logs failure, and succeeds on manual retry; verify subsequent refreshes expose game updates and profile rename/deletion while public userIds remain stable, and document freshness/recovery/volume ownership limits.

## 4. Cross-system verification and cutover deliverables

- [x] 4.1 Run engine-backed HTTP contract checks for game search, autocomplete, and users, including alternative names, accented/quoted/punctuated names, wildcard input, filter combinations, and ties. Compare legacy-compatible fixtures separately from intentional fixes; verify both legacy and v1 paths yield the same successful contract.
- [x] 4.2 Verify exact filtered totals and deep pages on datasets above the pinned engine's default result window; set supported total/window query options as needed and confirm no lower-bound count is exposed as an exact total within the documented API bounds.
- [x] 4.3 Exercise combined ordinary API/search requests during an index rebuild with a bounded local load self-check; record request latency, memory, CPU, engine resources, and rebuild duration, including reproducible commands and the need to repeat against representative deployment traffic before retirement.
- [x] 4.4 Deliver a cutover/rollback runbook with old-host path-preserving routing examples, legacy web/mobile/admin request smoke checks, separate index-volume staging, observed scheduled-refresh gates, Go-replica retirement, and retained rollback assets. Verify the smoke commands against the disposable deployment and distinguish delivered instructions from production actions not executed.
- [x] 4.5 Run the search unit/integration checks and project build; review the final diff to confirm existing SQL/Fuse filters, collections/trending callers, IGDB change artifacts, sibling repositories, and database data are untouched. Record results and any environment limitations in the implementation handoff.

## Workflow follow-up

- Before production retirement, supply active hostname/proxy inputs, run representative traffic comparison and released-client smoke checks, observe both scheduled refreshes, and accept the rollback retention period. Production routing/service shutdown requires an operational deployment request; local implementation completion does not assert production cutover happened.
- After accepted cutover, stop the old Go API and its indexing owner, retain rollback volumes/config until accepted, and record actual infrastructure savings. Keep one server-owned Manticore instance.
- Archive this change after implementation review and applicable verification are complete; preserve any unexecuted production operations explicitly in the handoff.
