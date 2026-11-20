# Tasks

## 1. Normalized game names

- [x] 1.1 Add migration `AddGameSearchName` with the two `STORED` generated `searchName` columns and a `down` that drops them, and declare both on `Game` and `GameAlternativeName` with `generatedType: "STORED"`, the same `asExpression`, `insert: false`, `update: false`, `select: false` (design 2). Verify that `pnpm migration:run` and `pnpm typeorm migration:revert -d ./data-source.ts` succeed on an empty MySQL 8.4, that `migration:generate` reports no drift, that the migration-chain spec passes, and record in the PR how long `up` takes on the dev database copy.
- [x] 1.2 Confirm writers ignore the new columns: no raw `INSERT`/`SELECT *` into `game` or `game_alternative_name` breaks, game API responses do not contain `searchName`, and the Manticore source queries still index. Verify with `pnpm test:igdb:unit`, `pnpm test:igdb:integration` (with `test:igdb:services:up`) and `pnpm test:search:integration`.

## 2. Search predicate and listings

- [x] 2.1 Export `normalizeGameSearchQuery` from `src/search/search.service.ts` without changing it, and add the optional `search` field to `FindCollectionEntriesDto` (string, max 256, blank to `undefined`, Swagger `maxLength`) (design 3, 5). Verify with a DTO validation test: 256 characters pass, 257 return 400, `"   "` becomes `undefined`; and `pnpm test:search:unit` still passes.
- [x] 2.2 Add the private search helper to `CollectionsEntriesService` and use it in `findAllByUserIdWithPermissions`, `findFavoritesByUserId` and `findAllByCollectionIdWithPermissions`, combining with the custom-cover ids through `And`, and returning `[[], 0]` when nonblank input normalizes to empty (design 3). Verify with `collections-entries.service.spec.ts`: no search leaves the `where` unchanged, normalization-empty input returns an empty page without a query, and search plus `hasCustomCover` applies both conditions.
- [x] 2.3 Cover the spec against real MySQL in `collections-entries.service.integration.spec.ts`: title and alias substring, partial word, no match across two aliases or out-of-order words, apostrophe/accent/case/punctuation variants including decomposed-accent input, `100%` and `' OR 1=1 --` as literal text, a catalog game not in the library is absent, a newly added entry is found immediately, a `private` entry is neither returned nor counted for an anonymous viewer, hidden library returns an empty page, default categories exclude a matching DLC unless requested, favorites and collection listings narrow the same way, and `orderBy`/offset/limit/totals behave as in the spec's "Ordering and pages" scenario.
- [x] 2.4 Check performance against the design numbers: run `EXPLAIN ANALYZE` of the generated SQL for a 2,000+ entry library (fixture or dev copy) and confirm the plan uses the library index, primary-key lookups on `game`, the `gameId` index on aliases and no regex at query time. Add a `shortcut:` comment on the helper with the ≥20k-entry upgrade path (design Risks).

## 3. Contract and client hand-off

- [x] 3.1 Regenerate `server_swagger.json` by booting the app, and confirm `search` appears on `GET /v1/collections-entries/library/{id}`, `GET /v1/collections-entries/library/{userId}/favorites` (query) and on the `POST /v1/collections-entries/collection/{id}` body schema.
- [x] 3.2 Write `handoff-clients.md` in this change with everything listed in design 6, in the format of `openspec/changes/add-library-visibility/handoff-clients.md`, stating that client implementation is a separate change in `game-node-clients`. Verify that every route, field, limit, status code and example in the document matches the implemented DTOs, the regenerated Swagger, and the integration tests.
- [x] 3.3 Run `pnpm test:typecheck`, `pnpm lint` and the unit suites under `src/collections`, `src/search` and `src/libraries`, and confirm the app boots.

## Workflow follow-up

- Archive the change after the hand-off is delivered and the implementation is reviewed.
