# Search Module (`src/search`)

Server-owned Manticore search API consolidating the legacy `game-node-search` Go service into `game-node-server`.

## Routes

All routes accept unauthenticated `POST` requests with JSON bodies, return `HTTP 200`, and are exposed both at neutral legacy paths and `/v1` URI-versioned paths:

- `POST /search/games` and `POST /v1/search/games`
- `POST /search/games/autocomplete` and `POST /v1/search/games/autocomplete`
- `POST /search/users` and `POST /v1/search/users`

## Request Validation & Limits

Despite the global `ValidationPipe` using `enableImplicitConversion: true`, the search boundary preserves raw JSON types via `@PreserveRawValue()` and enforces strict validation before any Manticore request is made:

| Parameter | Endpoints | Type & Constraints | Default |
| --- | --- | --- | --- |
| `query` | `games`, `games/autocomplete` | Optional `string`, max `256` characters. Omitted or `""` browses by filters (`games`) or short-circuits to `{ data: [], total: 0 }` (`games/autocomplete`). | `undefined` |
| `query` | `users` | Required `string`, trimmed length `>= 1`, max `256` characters. | Required |
| `category` | `games`, `games/autocomplete` | Optional `number[]` of valid `EGameCategory` enum integers (`0..14`), max `100` entries. | `undefined` |
| `status` | `games`, `games/autocomplete` | Optional `number[]` of valid `EGameStatus` enum integers (`0, 2..8`), max `100` entries. | `undefined` |
| `genres` | `games`, `games/autocomplete` | Optional `string[]` (each max `256` characters), max `100` entries. Resolved by exact case-insensitive genre name or decimal ID. | `undefined` |
| `themes` | `games`, `games/autocomplete` | Optional `string[]` (each max `256` characters), max `100` entries. Resolved by exact case-insensitive theme name or decimal ID. | `undefined` |
| `platforms` | `games`, `games/autocomplete` | Optional `string[]` (each max `256` characters), max `100` entries. Resolved by exact case-insensitive platform name, platform abbreviation, or decimal ID. | `undefined` |
| `limit` | All | Optional integer `1..100` (or `0`/omitted for default). Autocomplete validates input and then forces `limit = 5`. | `20` (`5` on autocomplete) |
| `page` | All | Optional integer `>= 1` (or `0`/omitted for default). Autocomplete validates input and then forces `page = 1`. | `1` |
| Effective offset | All | `((effectivePage - 1) * effectiveLimit) <= 10000` (`SEARCH_MAX_OFFSET`). | `0` |
| `profile` | `games`, `games/autocomplete` | Optional `boolean`. Accepted for client compatibility; engine execution profiles are never exposed in public responses. | `undefined` |

## Intentional Corrections Over Legacy `game-node-search`

1. **Declared relation filters apply**: `genres`, `themes`, and `platforms` string arrays were declared in the legacy Go DTOs but ignored by the query builder. They now resolve against persisted MySQL resource tables (exact case-insensitive names, decimal IDs, and platform abbreviations) and filter indexed multi-value relation IDs (`genre_ids`, `theme_ids`, `platform_ids`) in Manticore using `OR` within each field and `AND` across populated fields. A populated filter containing only unrecognized values returns an empty result set rather than unfiltered games.
2. **Accurate pagination metadata**:
   - `totalItems` and `totalPages` are derived from engine hit totals without 16-bit integer narrowing (`uint16`), and are preserved even when requesting an empty page beyond the last page.
   - `hasNextPage` is computed from `page < totalPages` (and `offset + items.length < totalItems`) for both game and user search, fixing the legacy user search bug where page 2 of 21 results (`limit: 20`) reported `hasNextPage: true`.
   - Autocomplete always executes `page: 1, limit: 5` regardless of caller-supplied `page`/`limit`.
3. **Strict boundary validation & controlled upstream errors**:
   - Invalid field types (such as stringified numbers or booleans), negative/fractional pagination, out-of-range enums, and excessive offsets return `HTTP 400` before contacting Manticore.
   - Engine connection/availability errors return `HTTP 503`, timeouts (`5000ms`) return `HTTP 504`, and explicit engine errors, `timed_out: true`, or malformed upstream payloads return `HTTP 502` without leaking internal URLs, SQL, credentials, or raw upstream bodies.

## Disposable Search Test Harness (`test/search`)

The disposable integration test stack (`test/search/docker-compose.yml`) uses Compose project name `search-api-test` and dedicated named volumes (`mysql-search-test-data`, `manticore-search-test-data`) bound to loopback ports (`127.0.0.1:23306`, `127.0.0.1:29306`, `127.0.0.1:29308`). Starting or tearing down this stack does not affect development/production `game-node-server` volumes or the `igdb-sync-test` harness.

```bash
# Start disposable MySQL + Manticore 7.4.6 fixture services
npm run test:search:services:up

# Run search unit tests
npm run test:search:unit

# Run engine-backed search integration tests
npm run test:search:integration

# Stop and remove only the disposable search-api-test containers and volumes
npm run test:search:services:down
```

## Manticore Indexing, Schedules, & Operational Commands

- **Engine image**: `manticoresearch/manticore:7.4.6`
- **Config template**: `docker/manticore/manticore.conf.template` rendered to `/etc/manticoresearch/manticore.conf` at container start by `docker/manticore/entrypoint.sh` using required `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, and `DB_DATABASE` environment variables.
- **Display label session limit**: `SET SESSION group_concat_max_len = 65535` is executed before indexing `games_source` so high-fanout relation display labels are not truncated at MySQL's default 1024-byte `GROUP_CONCAT` limit, while relation IDs (`genre_ids`, `theme_ids`, `platform_ids`) are indexed directly via `sql_attr_multi` queries.
- **Schedules (UTC)** (`CREATE_PLAIN_TABLES="games:0 3 * * *;users:0 * * * *;games;users"`):
  - Initial startup builds both `games` and `users` plain indexes.
  - `games`: rebuilt daily at `03:00 UTC` (`0 3 * * *`).
  - `users`: rebuilt hourly at minute `0` (`0 * * * *`).
- **Single indexing owner & non-overlap lock**:
  - Only the single `manticore` service instance owns the `/var/lib/manticore` volume and runs `indexer`; scaling `server` API replicas (`deploy.replicas: 2`) never duplicates index rebuilds.
  - Scheduled cron jobs and manual rebuilds invoke `/etc/manticoresearch/reindex.sh`, which drops root privileges to user `manticore` via `gosu`, acquires a non-blocking exclusive `flock` on `/var/run/manticore/manticore-indexer.lock` (falling back to `/tmp/manticore-indexer.lock`), and uses `indexer --rotate` when `searchd` is running so failed rebuilds leave the previous serving index intact.
- **Freshness, recovery, & volume ownership limits**:
  - **Freshness window**: Plain indexes reflect persisted MySQL data as of the last completed build. Game catalog or popularity updates become searchable at the next daily `03:00 UTC` build (or after a manual rebuild); public profile additions, username renames, and deletions become searchable at the next hourly `:00 UTC` build (or after a manual rebuild). Internal numeric document IDs in `users` (`ROW_NUMBER() OVER (ORDER BY profile.userId)`) may shift across rebuilds as profiles are added or deleted, while the public string `userId` (`user_id` attribute) remains stable.
  - **Failure preservation & manual recovery**: Because `reindex.sh` runs `indexer --rotate` when `searchd` is active, a MySQL source outage or query failure aborts before rotating `.new.*` index files into place, logs `[manticore-reindex] ERROR: index build failed`, and exits `1` while `searchd` continues serving the last-good index. Once MySQL connectivity recovers, run the manual rebuild command below to publish fresh indexes without restarting `server` or `manticore`.
  - **Exclusive volume ownership**: Never mount the `/var/lib/manticore` volume (`manticore-data`) into simultaneous writer containers (such as running both the legacy `game-node-search` Manticore container and the `game-node-server` Manticore container against the same volume). Stage cutover on a separate volume or stop the old writer before reusing a volume.
- **Manual rebuild commands**:
  ```bash
  # Rebuild both plain indexes with rotation and non-overlap locking (dev compose)
  docker compose exec -u manticore manticore /bin/bash /etc/manticoresearch/reindex.sh games users

  # Rebuild both plain indexes in production compose
  docker compose -f docker-compose.prod.yml exec -u manticore manticore /bin/bash /etc/manticoresearch/reindex.sh games users

  # Rebuild only games or only users
  docker compose exec -u manticore manticore /bin/bash /etc/manticoresearch/reindex.sh games
  docker compose exec -u manticore manticore /bin/bash /etc/manticoresearch/reindex.sh users

  # Inspect installed UTC schedules and recent rebuild logs
  docker compose exec manticore crontab -u manticore -l
  docker compose logs --tail=100 manticore
  ```
