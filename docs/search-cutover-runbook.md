# Search API Consolidation: Cutover & Rollback Runbook

This runbook documents the staged verification, reverse-proxy routing, scheduled-refresh gates, legacy Go service retirement, and rollback procedure for consolidating `game-node-search` into `game-node-server`.

> **Implementation vs. Production Execution Status**
>
> - **Delivered and verified in this repository**:
>   - `SearchModule` (`POST /search/games`, `/search/games/autocomplete`, `/search/users` and `/v1/search/*` equivalents)
>   - Server-owned `manticoresearch/manticore:7.4.6` configuration template (`docker/manticore/manticore.conf.template`), fail-fast entrypoint (`docker/manticore/entrypoint.sh`), and `flock`-serialized rotation script (`docker/manticore/reindex.sh`)
>   - Development (`docker-compose.yml`), production (`docker-compose.prod.yml`), and disposable test (`test/search/docker-compose.yml`) service definitions
>   - Automated unit, contract, deep-window pagination, failure/recovery, load self-check, and smoke-command verification against the disposable MySQL + Manticore 7.4.6 deployment
> - **Production actions NOT executed during code implementation** (require operator execution in the target deployment environment):
>   - Provisioning the production `manticore` service against `server-db`
>   - Switching external DNS / reverse-proxy upstreams for the active production search hostname
>   - Observing live production `03:00 UTC` (`games`) and hourly `:00 UTC` (`users`) scheduled refreshes
>   - Stopping or decommissioning the running production Go `game-node-search` replicas and retaining/removing rollback volumes

---

## 1. Recorded Local Combined Load & Rebuild Self-Check (Task 4.3)

Before retiring the separate Go search deployment, combined ordinary API/MySQL traffic and Manticore search traffic must be exercised during an active index rebuild.

### Reproducible Local Self-Check Commands

```bash
# 1. Start the disposable MySQL 8.0 + Manticore 7.4.6 harness
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
   DB_HOST=server-db
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

# 2. Web / Mobile game search on neutral legacy path (/search/games) and v1 path (/v1/search/games)
curl -sS -X POST "${API_URL}/search/games" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden Ring","category":[0],"status":[0],"genres":["Role-playing (RPG)"],"platforms":["PC"],"page":1,"limit":20}'

curl -sS -X POST "${API_URL}/v1/search/games" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden Ring","category":[0],"status":[0],"genres":["Role-playing (RPG)"],"platforms":["PC"],"page":1,"limit":20}'

# 3. Web / Mobile game autocomplete (/search/games/autocomplete and /v1/search/games/autocomplete)
curl -sS -X POST "${API_URL}/search/games/autocomplete" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden"}'

curl -sS -X POST "${API_URL}/v1/search/games/autocomplete" \
  -H "Content-Type: application/json" \
  -d '{"query":"Elden"}'

# 4. Web / Mobile / Admin public user lookup (/search/users and /v1/search/users)
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

1. **Restore reverse-proxy upstream**:
   - Point the legacy search hostname (`search.gamenode.app`) upstream back to the retained `game-node-search` Go service (and ensure the legacy Manticore container with its retained volume is running).
   - Reload the reverse proxy (`nginx -s reload` or `caddy reload`).
2. **Optional main-API fallback**:
   - If callers using `/v1/search/*` on the main API also need to target the previous Manticore instance during investigation, update `MANTICORE_URL` on `game-node-server` to the retained engine address and restart `server`.
3. **Stop duplicate indexing**:
   - Stop the new `manticore` container (`docker compose -f docker-compose.prod.yml stop manticore`) if reverting to the old indexing owner so only one Manticore instance runs scheduled builds against MySQL.
4. **Zero data loss**:
   - Because this consolidation introduces no destructive MySQL migrations and requires no client code changes, rollback is immediate and lossless.
