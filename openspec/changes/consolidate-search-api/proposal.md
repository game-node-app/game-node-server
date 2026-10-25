# Proposal

## Why

Search currently requires a separate Go API deployment and a separately maintained Manticore configuration. Consolidating ownership in game-node-server removes the extra API runtime and deployment cost while retaining search performance and keeping existing web, mobile, and admin clients working.

## What Changes

- Serve game search, game-name autocomplete, and username search inside NestJS, preserving public POST `/search/games`, `/search/games/autocomplete`, and `/search/users`, request types, flattened response fields, and response envelopes. Also expose `/v1/search/*` for the main API.
- Keep the old search hostname routed directly to this API so released clients continue working without redirects or a running Go service.
- Preserve name/alternative-name search, username prefix matching, category/status filtering, five-name autocomplete, and relevance/views/release-date ordering; add deterministic ties.
- Make the existing but ignored genre, theme, and platform string filters work, with exact resource resolution and indexed relation IDs. Fix pagination, validate bounded requests, and handle engine failures without exposing internals.
- Move Manticore configuration, MySQL sources, initial indexing, scheduled game/user rebuilds, and operational documentation into this repository. Retain plain indexes and their existing refresh cadence, avoiding an unnecessary real-time indexing rewrite.
- Provide local contract/integration fixtures, index rebuild checks, and a cutover/rollback runbook. Retire the separate Go API replicas after successful parity verification.
- Intentional corrections: previously ignored filters narrow results; invalid/unbounded requests return 400; upstream failures return controlled 502/503/504 errors; pagination metadata is correct even on empty pages. Valid callers retain their successful response contract.

## Capabilities

### New Capabilities

- `search-api`: Compatible game search, autocomplete, user search, filter semantics, pagination, validation, and bounded engine access.
- `search-indexing`: Server-owned Manticore deployment, index contents, safe scheduled refreshes, and reversible consolidation of the search deployment.

### Modified Capabilities

None. There are no published main capability specs. The existing in-flight `igdb-catalog-sync` change remains independent; this change reads its persisted catalog and does not alter ingestion.

## Impact

- New `src/search/` module, DTOs, query/response mapping, tests, and registration in `src/app.module.ts`; compatibility with URI versioning, validation, CORS, authentication middleware, logging, and Swagger.
- New server-owned Manticore assets, development/production Compose configuration, environment example, disposable search test services, and README/runbook. Reuse installed Axios/Nest HTTP tooling; no new search SDK or service.
- MySQL game relations, statistics, and public profile fields are index inputs. Existing TypeORM filtering, importer Fuse search, collections, trending, profile listing, and IGDB ingestion retain their behavior.
- External operational dependency: route the old search hostname to the main API and remove the old Go service after verification. Sibling repositories are read-only references in this change; client regeneration or a separate client release is not required.
- Manticore compute/storage remain necessary. Actual net savings and production capacity must be measured; consolidation does not promise zero infrastructure cost. No database deletion, search-engine replacement, new filter dimensions, typo-tolerance redesign, or new ranking model.
