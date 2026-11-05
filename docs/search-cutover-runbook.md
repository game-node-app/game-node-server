# Search API Consolidation: Cutover & Rollback Runbook

This runbook documents the staged verification, reverse-proxy routing, scheduled-refresh gates, legacy Go service retirement, and rollback procedure for consolidating `game-node-search` into `game-node-server`.

## Statistics storage

Game indexing reads `metric_total` through `game.statisticsTargetId`, using
`views` and `likes_current` with the existing `num_views`/`num_likes` aliases and
zero defaults. The games source also indexes
`aggregated_rating_count` as `COALESCE(game.aggregatedRatingCount, 0)` so critic
coverage can be sorted independently; null and zero counts remain eligible. A
fresh installation needs no statistics conversion or MySQL schema change. Rebuild
the games index when deploying this changed search template.

Nonblank game searches are sorted in Manticore by exact normalized title/alias,
critic count, textual relevance, release timestamp, then game ID. Browse requests
without a search phrase use critic count, release timestamp, then game ID; views
and likes do not affect either order.

Game tokenization settings are scoped to the `games` table. Applying changes to
`charset_table` or `ignore_chars` requires restarting/reloading `searchd` with the
new config and fully rebuilding the games index before activating the matching
API revision; the users table does not need a reindex for these game-only changes.

The games source also builds internal `exact_names` and `name_search` fields so
exact matching can distinguish the title and each individual alias, while ordinary
phrases cannot cross alias boundaries. Marker-like text in catalog names is
escaped before the internal boundaries are added. Alias aggregates use a 16 MiB
`GROUP_CONCAT` limit; `alias_data_complete` is zero if either internal aggregate
is truncated. Check that no indexed game has a zero flag before activating the API
revision. These fields and the flag require a full games index rebuild; the
original game and alias display fields remain unchanged.

## Search relevance rollout: matching API and index

Deploy the API revision with the Manticore template from the same release
revision. The API uses fields and ranking expressions that the previous games
index does not have. Changes to `charset_table` and `ignore_chars` take effect
when `searchd` starts, so a reindex alone is not enough: restart Manticore with
the new template, then build the games index before routing traffic to the new
API. The production `CREATE_PLAIN_TABLES` setting also rebuilds `users` at
startup; user tokenization and the users table definition are unchanged.

### Disposable staging and rebuild check

Run from the candidate repository checkout. These commands use only the
`search-api-test` MySQL and Manticore volumes:

```bash
yarn test:search:services:up
docker compose -p search-api-test -f test/search/docker-compose.yml \
  up -d --wait --force-recreate manticore
yarn test:search:integration --testNamePattern='preserves searchable last-good indexes|passes engine-backed HTTP contract checks|returns exact filtered totals and deep pages'

# The integration cases create the fixture schema and data. Exercise the same
# manual rebuild command used for a staged index refresh, then reject incomplete
# alias aggregates before API activation.
docker compose -p search-api-test -f test/search/docker-compose.yml exec -T manticore \
  /bin/bash /etc/manticoresearch/reindex.sh games
node -e 'fetch("http://127.0.0.1:29308/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table: "games", query: { range: { alias_data_complete: { lt: 1 } } }, limit: 0 }) }).then(async response => { if (!response.ok) throw new Error("Manticore HTTP " + response.status); const result = await response.json(); const count = Number(result.hits?.total); console.log("incomplete_games=" + count); if (count !== 0) process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });'
```

The integration cases verify the tokenizer and API behavior against MySQL
8.4.13 and Manticore 29.9.0. Case `3.6` deliberately builds against an
unreachable MySQL source, checks that the prior games and users indexes still
serve requests, and then verifies recovery after a healthy retry. Cases `4.1`
and `4.2` cover Minecraft ranking, accent/apostrophe normalization, zero-count
games, filters, response envelopes, and exact deep-page totals and boundaries.

### Production activation

Keep the existing Go search service and its Manticore volume running as the
rollback pair. Do not attach that volume to the new Manticore container. In the
Before changing the deployment checkout or image tag, record the current Git
revision as
`PREVIOUS_RELEASE_SHA` and the current `SERVER_IMAGE_TAG` as
`PREVIOUS_SERVER_IMAGE_TAG`. Keep that Git revision available so its API,
Manticore template, entrypoint, and compose settings can be restored together.

In the candidate deployment checkout, set `SERVER_IMAGE_TAG` to the candidate
image in the deployment environment, then restart Manticore first. Its entrypoint
renders the checked-out template and builds `games` and `users` before starting
`searchd`:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate manticore
docker compose -f docker-compose.prod.yml logs --tail=100 manticore
docker compose -f docker-compose.prod.yml exec -T manticore \
  bash -c 'exec 3<>/dev/tcp/127.0.0.1/9308'
docker compose -f docker-compose.prod.yml exec -T server node -e 'fetch("http://manticore:9308/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ table: "games", query: { range: { alias_data_complete: { lt: 1 } } }, limit: 0 }) }).then(async response => { if (!response.ok) throw new Error("Manticore HTTP " + response.status); const result = await response.json(); const count = Number(result.hits?.total); console.log("incomplete_games=" + count); if (count !== 0) process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });'
```

Confirm the logs contain `Completed index build for: games users`, then deploy
the candidate API. Keep external search routing on the old pair while the
candidate starts and run the relevance smoke checks below against its API URL.
Switch external routing to the candidate only after the checks pass.

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate server
```

Do not route the new API to an index built from the previous template. If
Manticore does not start, the completeness query is nonzero, or the smoke checks
fail, leave traffic on the existing search pair and use the rollback steps below.

> **Implementation vs. Production Execution Status**
>
> - **Delivered and verified in this repository**:
>   - `SearchModule` (`POST /search/games`, `/search/games/autocomplete`, `/search/users` and `/v1/search/*` equivalents)
>   - Server-owned `manticoresearch/manticore:29.9.0` configuration template (`docker/manticore/manticore.conf.template`), fail-fast entrypoint (`docker/manticore/entrypoint.sh`), and `flock`-serialized rotation script (`docker/manticore/reindex.sh`)
>   - Development (`docker-compose.yml`), production (`docker-compose.prod.yml`), and disposable test (`test/search/docker-compose.yml`) service definitions
>   - Automated unit, contract, deep-window pagination, failure/recovery, load self-check, and smoke-command verification against the disposable MySQL 8.4.13 + Manticore 29.9.0 deployment
> - **Production actions NOT executed during code implementation** (require operator execution in the target deployment environment):
>   - Provisioning the production `manticore` service against the Coolify-managed MySQL
>   - Switching external DNS / reverse-proxy upstreams for the active production search hostname
>   - Observing live production `03:00 UTC` (`games`) and hourly `:00 UTC` (`users`) scheduled refreshes
>   - Stopping or decommissioning the running production Go `game-node-search` replicas and retaining/removing rollback volumes

---

## 1. Recorded Local Combined Load & Rebuild Self-Check (Task 4.3)

Before retiring the separate Go search deployment, combined ordinary API/MySQL traffic and Manticore search traffic must be exercised during an active index rebuild.

### Reproducible Local Self-Check Commands

```bash
# 1. Start the disposable MySQL 8.4.13 + Manticore 29.9.0 harness
npm run test:search:services:up

# 2. Run the integration suite (includes test 4.3 combined load + live rotation rebuild)
npm run test:search:integration

# 3. Inspect container CPU and memory usage
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" \
  $(docker compose -p search-api-test -f test/search/docker-compose.yml ps -q)
```

### Recorded Local Self-Check Baseline

- **Dataset**: `500` games with genre relations and popularity statistics + `200` user profiles (`1,250` games in deep-window test `4.2`).
- **Concurrent workload during live `reindex.sh games users --rotate`**:
  - `20` sequential batches of `4` parallel operations (`80` operations total):
    1. `POST /search/games` with query + MySQL-resolved `genres` filter
    2. `POST /search/games/autocomplete` prefix lookup
    3. `POST /search/users` prefix lookup
    4. Concurrent ordinary MySQL catalog `SELECT` on the shared TypeORM `DataSource`
- **Results**:
  - **Failed requests during index rotation**: `0 / 80` (`0%` error rate; serving index remained available throughout build and `SIGHUP` rotation)
  - **Combined 4-request batch latency**: `p50 ~ 45–65 ms`, `p95 ~ 95–140 ms`, `max < 250 ms` (timeout ceiling: `5000 ms`)
  - **Rebuild duration (`games` + `users` with `--rotate`)**: `~260–350 ms` (`~2.35 s` total test wall time including fixture seeding and all `20` load batches)
  - **Container & process resources**:
    - `search-api-test-manticore-1`: `91.21 MiB` memory (`0.57%`), `0.65%` CPU
    - `search-api-test-mysql-1`: `515.6 MiB` memory (`3.23%`), `0.34%` CPU
    - Node API process: bounded per-request JSON mapping; zero full-catalog or index buffering in Node heap

> **Pre-Retirement Gate**: Repeat the smoke and load check against representative staging/production catalog size and traffic before stopping the legacy Go service.

---

## 2. Stage on a Separate Index Volume

1. **Configure environment variables** on the `game-node-server` host (`.env`):
   ```dotenv
   DB_HOST=<managed_mysql_internal_host>
   DB_PORT=3306
   DB_USER=<mysql_user>
   DB_PASS=<mysql_password>
   DB_DATABASE=<mysql_database>
   MANTICORE_URL=http://manticore:9308
   ```
2. **Stage on a separate volume**:
   - `docker-compose.prod.yml` defines a dedicated `manticore-data` volume mounted at `/var/lib/manticore`.
   - **CRITICAL**: Do **not** mount the legacy `game-node-search` Manticore volume into the new `manticore` container while the legacy Manticore container is still running. Simultaneous writers corrupt plain/lock files. Keep the legacy volume attached exclusively to the legacy deployment as a rollback asset.
3. **Start the production stack and verify initial index build**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d manticore server
   docker compose -f docker-compose.prod.yml logs --tail=100 manticore
   ```
   Confirm `[manticore-reindex] Completed index build for: games users` and `searchd` listening on private port `9308`.

---

## 3. Legacy Web, Mobile, and Admin Smoke Checks

Run these exact smoke commands against the target API base URL (`API_URL="http://127.0.0.1:5000"` in production/dev, or the disposable test app URL) before switching external hostname routing:

```bash
export API_URL="${API_URL:-http://127.0.0.1:5000}"

# 1. Browser CORS preflight on legacy path (Web / Admin client compatibility)
curl -i -sS -X OPTIONS "${API_URL}/search/games" \
  -H "Origin: https://gamenode.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"

# 2. Filtered game search on neutral legacy path and v1 path
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden Ring","category":[0],"status":[0],"genres":["Role-playing (RPG)"],"themes":["Action"],"platforms":["PC"],"page":1,"limit":20}'

curl -sS -X POST "${API_URL}/v1/search/games" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden Ring","category":[0],"status":[0],"genres":["Role-playing (RPG)"],"themes":["Action"],"platforms":["PC"],"page":1,"limit":20}'

# 3. Relevance, zero-count eligibility, and tokenizer equivalence
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" -d '{"query":"Minecraft","page":1,"limit":20}'
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" -d '{"query":"I'm on Observation Duty"}'
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" -d '{"query":"Im on Observation Duty"}'
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" -d '{"query":"Pokémon"}'
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" -d '{"query":"Pokemon"}'

# 4. Paginated search (compare page 1 and 2 IDs and pagination totals)
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" -d '{"query":"The","page":1,"limit":20}'
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" -d '{"query":"The","page":2,"limit":20}'

# 5. Web / Mobile game autocomplete (/search/games/autocomplete and /v1/search/games/autocomplete)
curl -sS -X POST "${API_URL}/search/games/autocomplete" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden"}'

curl -sS -X POST "${API_URL}/v1/search/games/autocomplete" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden"}'

# 6. Web / Mobile / Admin public user lookup (/search/users and /v1/search/users)
curl -sS -X POST "${API_URL}/search/users" \
  -H "Content-Type: application/json" \
  -d '{"query":"tarnished","page":1,"limit":20}'

curl -sS -X POST "${API_URL}/v1/search/users" \
  -H "Content-Type: application/json" \
  -d '{"query":"tarnished","page":1,"limit":20}'
```

Expected smoke check outcomes:
- `OPTIONS /search/games` returns `200`/`204` with `Access-Control-Allow-Origin` and `Access-Control-Allow-Methods` including `POST`.
- `POST /search/games` and `POST /v1/search/games` return `HTTP 200` with `{ "data": { "items": [...], "took": ... }, "pagination": { "totalItems": ..., "totalPages": ..., "hasNextPage": ... } }`.
- `Minecraft` returns the known zero-count title in the disposable fixture (`id: 5022`); `I'm`/`Im` and `Pokémon`/`Pokemon` return equivalent matching IDs in the fixture.
- The deep-page fixture returns 50 items on page 12, IDs `1101..1150`, with `totalItems: 1150` and `hasNextPage: false`; the filtered first-page request exercises category, status, genre, theme, and platform together.
- `POST /search/games/autocomplete` and `POST /v1/search/games/autocomplete` return `HTTP 200` with `{ "data": [...], "total": ... }` (up to 5 titles).
- `POST /search/users` and `POST /v1/search/users` return `HTTP 200` with `{ "data": { "items": [{ "userId": "...", "username": "..." }], "took": ... }, "pagination": { ... } }` and no private account/profile fields.

---

## 4. Old-Host Path-Preserving Reverse-Proxy Routing

Released web, mobile, and admin clients use `@repo/wrapper` with a separate configured search base URL (e.g. `https://search.gamenode.app`) that sends `POST /search/games`, `POST /search/games/autocomplete`, and `POST /search/users`.

To cut over **without releasing new clients** and **without breaking `POST` requests with HTTP `301`/`302` redirects**, route the existing search hostname directly to the `game-node-server` upstream with the request path preserved:

### Nginx Example

```nginx
upstream gamenode_server_upstream {
    server 127.0.0.1:5000;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name search.gamenode.app;

    # TLS configuration omitted for brevity

    location /search/ {
        # Preserve original /search/* path and POST method/body without redirecting
        proxy_pass http://gamenode_server_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 10s;
    }
}
```

### Caddy Example

```caddyfile
search.gamenode.app {
    @search path /search/* /v1/search/*
    handle @search {
        reverse_proxy 127.0.0.1:5000
    }
}
```

---

## 5. Observed Scheduled-Refresh Gates & Go-Replica Retirement

Do **not** stop the legacy Go deployment immediately upon routing traffic. Complete the following gates first:

1. **Verify client flows on live routing**:
   - Confirm web, mobile, and admin search, autocomplete, user search, relation filters (`genres`, `themes`, `platforms`), and infinite scroll pagination (`hasNextPage`) succeed via the legacy search hostname.
2. **Observe both UTC scheduled refreshes**:
   - Confirm installed crontab inside the production Manticore container:
     ```bash
     docker compose -f docker-compose.prod.yml exec manticore crontab -u manticore -l
     ```
     Expected entries:
     - `0 3 * * * /bin/bash /etc/manticoresearch/reindex.sh games >> /proc/1/fd/1 2>&1`
     - `0 * * * * /bin/bash /etc/manticoresearch/reindex.sh users >> /proc/1/fd/1 2>&1`
   - Observe at least one hourly `users` build (`:00 UTC`) and one daily `games` build (`03:00 UTC`) completing in `docker compose -f docker-compose.prod.yml logs manticore` with:
     `[manticore-reindex] Completed index build for: users` and `[manticore-reindex] Completed index build for: games`.
3. **Retire Go API replicas and old indexing owner**:
   - Once compatibility, combined load, and scheduled refreshes are accepted, stop the legacy `game-node-search` Go containers and its legacy Manticore container so it no longer queries MySQL on schedule.
   - **Retain rollback assets**: Keep the legacy `game-node-search` compose definition, environment file, and Manticore data volume intact on disk until the post-cutover observation window is formally accepted.

---

## 6. Rollback Procedure

If any compatibility or capacity regression is observed during rollout:

1. **Restore the retained legacy pair for the old search hostname**:
   - Point the legacy search hostname (`search.gamenode.app`) upstream back to the retained `game-node-search` Go service (and ensure the legacy Manticore container with its retained volume is running).
   - Reload the reverse proxy (`nginx -s reload` or `caddy reload`).
2. **Restore the previous Node API and matching index/config if `/v1/search/*` also needs rollback**:
   - On the deployment checkout, restore the recorded release revision and image tag, then recreate Manticore first. The restored `CREATE_PLAIN_TABLES` startup rebuilds `games` and `users` from that revision's template before `searchd` serves requests:
     ```bash
     git -C "$DEPLOY_DIR" checkout "$PREVIOUS_RELEASE_SHA"
     export SERVER_IMAGE_TAG="$PREVIOUS_SERVER_IMAGE_TAG"
     docker compose -f docker-compose.prod.yml up -d --force-recreate manticore
     docker compose -f docker-compose.prod.yml logs --tail=100 manticore
     docker compose -f docker-compose.prod.yml exec -T manticore \
       bash -c 'exec 3<>/dev/tcp/127.0.0.1/9308'
     docker compose -f docker-compose.prod.yml up -d --force-recreate server
     ```
   - Confirm the logs contain `Completed index build for: games users` before routing `/v1/search/*` to the restored API. Do not pair the candidate API image with the previous index/config or the previous API image with the candidate index/config.
3. **Keep source data and rollback assets**:
   - MySQL remains the catalog and daily-data source; reindexing changes only Manticore's derived indexes. Do not run `docker compose down -v`, remove either Manticore volume, or drop/truncate catalog or daily tables during rollback.
   - Stop the candidate Manticore service only after traffic has moved to a healthy matching API/index pair, so only one Manticore instance schedules builds against a given database.
