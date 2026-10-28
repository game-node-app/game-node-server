# Design

## Context

See proposal.md for motivation and the two capability deltas for acceptance behavior. The user explicitly chose to preserve existing clients.

Observed source and destination:

- `../game-node-search/main.go` exposes three public POST routes. `search/games/search.go` sends an anchored phrase over `name,alternative_names`, category/status IN filters, and a relevance/views/release-date sort. Autocomplete appends `*` and forces limit 5 but retains the caller's page. User search matches username prefixes.
- The Go DTO declares genre/theme/platform string arrays but the query builder ignores them. Profile is accepted but never forwarded. Pagination loses totals on empty pages; user hasNextPage ignores page; totals use a 16-bit page count. Error handling overwrites intermediate errors and the game handler can ignore a mapping failure.
- `../game-node-search/manticore.conf` defines plain MySQL-sourced games/users tables and name infix settings. Compose pins Manticore 7.4.6 and runs initial builds plus daily game/hourly user indexing. Optional relations use LEFT JOINs. Profile engine IDs use ROW_NUMBER; public IDs remain strings.
- The Go response declares some optional fields absent from the SQL projection (summary, storyline, checksum, ratings). They are not a reason to index large descriptions during this consolidation; retain them as optional in the response schema. Existing present fields and timestamps are the compatibility baseline.
- `../game-node-clients/packages/wrapper/src/search` and its checked-in Swagger input define the legacy contract. Shared hooks consume flattened fields, page/limit, and hasNextPage. `packages/wrapper/src/setUp.ts` configures independent server/search URLs; web, mobile, and admin supply those URLs. No client release is necessary if the old host routes to NestJS.
- This server uses NestJS 11, URI versioning with default v1, global ValidationPipe with implicit conversion, SuperTokens middleware, global Axios error filtering, Pino, installed Axios/Nest HTTP tooling, and Jest/Supertest. Existing pagination is offset-based and has a different envelope. Development Compose has an unused Manticore volume but no engine; production has no engine.
- `GameRepositoryFilterDto` and `buildGameFilterFindOptions` use numeric IDs and already serve repository, trending, and collections callers. Importer uses list-specific Fuse search. These have different contracts and remain untouched. The existing IGDB change writes MySQL; no ingestion dependency or new per-game indexing job is needed.

## Goals / Non-Goals

**Goals:** Put search runtime and operational assets in this repository with the smallest compatible Nest module, exact filtering in the engine, bounded per-request work, and a documented reversible cutover.

**Non-Goals:** Replace Manticore, add real-time indexing or catalog-sized application caches, redesign ranking or fuzzy matching, merge unrelated SQL/Fuse filters, add new filter dimensions, edit sibling repositories, or provision production infrastructure during implementation. The runbook is required; executing its production cutover is a separate operational action.

## Decisions

### 1. One module and one shared engine request path

Add `src/search/` with controller, DTOs, service, and focused tests; import it in AppModule. Use one configured Axios/Nest HTTP client targeting a fixed games/users table and HTTP `/search`, with a five-second timeout. Reuse query and mapping logic for autocomplete. Do not install a Manticore SDK, introduce a generic search abstraction, or create a new microservice.

Catch and translate upstream errors inside this service so the global AxiosExceptionFilter cannot echo engine errors. Distinguish unavailable (503), timed out (504), and invalid engine response (502). Treat explicit engine errors or timed_out responses as failures; do not silently return misleading partial totals. Log compact failure metadata without credentials or raw bodies. API startup and unrelated health checks must not require Manticore availability; a search outage must not restart every main API replica.

Alternative: port the Go SDK layer literally. Rejected because Axios is already installed and the surface is three fixed operations.

### 2. Keep legacy routes alongside versioned routes

Explicitly register neutral and v1 versions for the search controller using Nest version metadata; verify exact generated paths under the actual URI versioning configuration. Return HTTP 200 explicitly for POST. Keep public access with existing auth middleware and CORS behavior. Do not apply the server PaginationInterceptor, whose envelope and offset convention differ.

Nest Swagger must describe the legacy request/response structures and both paths without conflicting operation IDs. Keep sibling generated wrapper names, exports, and search config working as-is; use its checked-in Swagger/models and fixtures as contract references rather than regenerating client code. Document that the old hostname routes to the same server upstream and preserves `/search/*`; do not use HTTP redirects for POST or require a deployment-wide versioning change.

Alternative: only implement `/v1/search/*` and release clients. Rejected by the compatibility requirement.

### 3. Validate without coercion and preserve successful payload shapes

Dedicated DTOs preserve the legacy field types. Override implicit conversion for this boundary so JSON strings/booleans are not silently treated as numeric pagination or valid booleans. Reject invalid known fields before engine calls; accept omitted optional fields. Preserve omitted/zero pagination defaults (page 1, limit 20), bound limits to 100, page to a positive integer, and effective offset to 10000; reject unsafe arithmetic. Bound query and individual filter strings to 256 characters and arrays to 100 entries. Validate category/status against existing game enums without changing those enums. Do not use the server BaseFindDto.

Allow empty/omitted game queries as filter-only match-all. Require a trimmed nonblank username query. Empty autocomplete returns `{data:[],total:0}`; autocomplete validates input but always executes page 1, limit 5. Accept the legacy profile boolean but omit engine profiles, as the source does in practice.

Map only an explicit allowlist of response fields. Use numeric game IDs from engine document IDs and retain `source: 'manticore'`. Preserve comma-space-separated flattened labels, ISO timestamp strings (including the legacy Unix-epoch representation for a zero release timestamp), optional-field omission, `data.items: []`, and userId strings. Do not add profile/account fields. Totals come from engine metadata even if hits is empty; calculate totalPages without narrowing to 16 bits and hasNextPage from offset plus returned count versus total.

Alternative: reuse the existing pagination/filter DTOs. Rejected because that changes page semantics, relation types, and response envelopes.

### 4. Keep matching semantics and make declared filters work

Use structured engine JSON, fixed field names, and the current anchored phrase behavior for games and prefix behavior for autocomplete/users. Preserve intended matching of names containing punctuation, accents, quotes, wildcard input, and alternative names through fixture checks against the pinned engine. Never interpolate caller data into SQL or let a caller submit an engine query object. Preserve score/views/release-date order in an ordered sort array and add ascending ID; user sort adds public userId after relevance.

Category/status remain engine IN predicates. For genre/theme/platform string filters, resolve exact names case-insensitively through existing MySQL resource repositories; decimal strings resolve as IDs and platforms also accept exact abbreviations. Resolve bounded arrays in a bounded number of queries, then apply resulting IDs to Manticore multi-value attributes. An unresolved entry contributes no matches; an entire unresolved populated field short-circuits to an empty result. OR within a field and AND across fields match the repository's existing filter convention. No substring matching on concatenated display strings and no post-pagination filtering in Node.

Add genre/theme/platform ID multi-value attributes to the plain game source using relation queries, avoiding truncation of ID membership by GROUP_CONCAT. Retain display labels separately and set/document adequate GROUP_CONCAT limits with a high-fanout fixture so display fields are not silently truncated. Coalesce missing popularity counts to zero. Missing relations continue to use LEFT JOIN semantics.

Alternative: only copy the existing filters. Rejected because it would perpetuate three declared no-op filters. Realtime index conversion is unnecessary for this fix.

### 5. Keep plain index refresh owned by Manticore

Move the existing configuration and pinned 7.4.6 deployment into this repo. Keep the current infix/exact-word settings and UTC schedules: games at 03:00 daily, users on the hour, initial build of both. Preserve ROW_NUMBER as internal users document ID for this plain full-rebuild design; public userId is the identity. Do not add a database migration solely for synthetic search IDs.

Use the image's existing initial/scheduled indexing mechanism with rotation, explicit UTC, and one engine/indexing owner, independent of server replicas. Verify that the pinned image's schedule runner serializes or locks builds; if it does not, add the smallest container-side lock around the same indexer commands. Rebuild failures must retain last-good indexes and expose a nonzero/logged failure, and manual commands must use the same locking/rotation path. Do not duplicate the scheduler in Nest/BullMQ. Full rebuilds incorporate catalog updates, username changes, and deletions without changes to mutation callers.

Provide a mounted config template rendered at container start using required database inputs with safe escaping, fail on missing/unsafe inputs, and do not commit production credentials or interpolate untrusted values into shell commands. Production connects to server-db privately, mounts a named persistent volume, and publishes no Manticore ports. Local engine ports bind loopback, and host-run Nest uses localhost:9308. Define MANTICORE_URL in server environment examples and production service configuration. Never mount one engine volume into simultaneous writers.

Alternative: incremental push jobs from every game/profile mutation. Rejected because plain rebuilds already provide the current freshness contract and require much less state and recovery logic.

References for implementation verification (current manual can differ from the pinned release): [JSON filters](https://manual.manticoresearch.com/Searching/Filters), [multi-value source attributes](https://manual.manticoresearch.com/Data_creation_and_modification/Adding_data_from_external_storages/Fetching_from_databases/Processing_fetched_data), and [plain builds and rotation](https://manual.manticoresearch.com/Data_creation_and_modification/Adding_data_from_external_storages/Plain_tables_creation). Pinned-engine integration checks are required before relying on an option.

## Risks / Trade-offs

- [Shared API resources] → Exercise combined ordinary API/search load and record latency, process memory, CPU, engine resources, and rebuild duration before retirement; this proposal does not claim measured savings.
- [Plain indexes are stale between builds] → Preserve and document daily/hourly freshness and manual refresh; defer real-time indexing until it is requested.
- [Filters now narrow results and invalid requests fail earlier] → Document these intentional corrections and cover them separately from successful-contract parity fixtures.
- [Rebuilds can load MySQL and need extra disk for rotation] → One indexing owner, nonoverlapping builds, adequate temporary disk, and last-good-index checks. Do not load index data into Node memory.
- [Engine HTTP total accuracy/result windows] → Verify exact totals and pagination above the engine's default window on 7.4.6; configure track-total/result-window options supported by that release so limits in the API spec are real, and never label a lower bound as an exact count.
- [Production host/proxy configuration is external] → Ship exact path/host smoke checks and rollback instructions; retain prior deployment until acceptance. Do not claim that adding Compose alone cuts costs.
- [Search response schema exceeds actual indexed fields] → Preserve actual populated legacy fields; no surprise large description fields or arbitrary entity serialization.
- [Indexing deployment credentials and profile privacy] → Required environment inputs, private ports, explicit source/response allowlists, no account joins or credential logging.

## Migration Plan

1. Implement and validate in this repo only. Use a disposable MySQL/Manticore fixture stack, not live IGDB or production credentials. Do not alter the existing IGDB change or its unchecked production verification task.
2. Deploy Nest search routes against the existing engine to smoke-test successful legacy requests before changing any hostname. Stage the new server-owned engine/config on a separate volume, build both indexes from the same database, and verify the new relation filters. Preserve the old engine/config/volume.
3. Test legacy and v1 paths, CORS/OPTIONS, sparse records, pagination, malformed input, engine failure, rebuild failure, and manual recovery. Compare source-compatible fixture results; separate intentional fixes and deterministic ties from regressions. Rehearse request and index rebuild load together and record before/after resource measurements. No production load threshold is invented here: acceptance requires no material regression against the recorded baseline at representative traffic.
4. Point the server at the verified index instance. Route every active legacy search hostname to the main API upstream with unchanged `/search/*` paths and TLS. Verify web/mobile/admin search, autocomplete, user lookup, and infinite pagination using existing client builds. Watch one successful scheduled refresh for each index before final retirement.
5. Stop the Go API replicas and old indexing owner after acceptance; keep rollback assets until the observation period has been accepted. Confirm no traffic or scheduled builds depend on the old service and record actual removed runtime resources. Manticore remains part of the main stack.
6. Rollback: restore the prior hostname upstream, server engine URL, and previous engine/indexing owner with its retained volume/config; stop the new owner before any shared-volume reuse. No MySQL destructive migration or client release is needed.

## Open Questions

- Deployment-time inputs only: which search hostname aliases and reverse-proxy configuration are currently active, what representative traffic baseline will be recorded, and how long the operator will retain rollback resources. These do not change the chosen API contract or implementation scope.
