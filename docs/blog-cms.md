# Blog CMS deployment and delivery

Directus 12.6.0 is the sole blog authoring system. The server serves published
articles and authenticated staff previews; clients never receive a Directus
credential. The trial and grant evidence are in [blog-cms-trial.md](blog-cms-trial.md).

The full server starts in an isolated environment and its OpenAPI is exported
to `server_swagger.json`. The paired client migration is not yet complete: the
client repository still uses the old blog contract. Complete that migration
before switching an application deployment to this CMS-backed API.

## Deploy on one host

1. Use the root `docker-compose.prod.yml` as the sole production definition.
   Prepare its external `game_node_app` network; the `gamenode` network is the
   Coolify destination shared with the managed MySQL.
   Configure the root `.env` from `.env.example`, or supply its variables through
   Coolify. Set unique random secrets and the acquired grant key, and restrict
   any local secret file to mode 600. The
   delivery and preview tokens must be different and at least 32 characters.
   Configure `BLOG_CMS_PUBLIC_URL` as the HTTPS staff origin, without a trailing
   slash. The key and tokens stay in the secret file, never in the repository.
2. Start the CMS on the same host as the application:

   ```sh
   docker compose -f docker-compose.prod.yml up -d --wait cms
   ```

   The CMS publishes no host port. Expose it only through the Coolify domain
   `https://cms.gamenode.app:8055` on the `cms` service and restrict access to
   editorial staff.
   The CMS uses the shared Coolify-managed MySQL 8.4.13 (`DB_HOST`), with its
   own `blog_cms` database/user and `CMS_DB_PASSWORD`. GameNode and SuperTokens
   have separate users scoped to `gamenode` and `supertokens`; the root password
   stays in the managed resource. No database host port is published.
   The `blog_cms` database/user must exist before the CMS starts: run
   `docker/mysql/init-databases.sh` once in the managed MySQL, as described in
   section 6.3 of the [infrastructure report](relatorio-reimplantacao-infraestrutura.md).
   It does not migrate existing databases or rotate existing passwords.
   The CMS keeps private assets separate from published media and reaches the
   application at `http://server:5000/v1` for game and profile checks. CMS
   credentials do not grant access to application data or community uploads.
3. Provision the model and service accounts on the new CMS. Choose distinct
   emails for the two service accounts. The CMS has no host port, so the
   scripts run in a temporary container on the private `game_node_app` network.
   Run these commands on the VPS from a checkout of the repository, with
   `CMS_ADMIN_EMAIL`, `CMS_ADMIN_PASSWORD`, `BLOG_CMS_DELIVERY_TOKEN` and
   `BLOG_CMS_PREVIEW_TOKEN` exported with the values set in Coolify:

   ```sh
   export CMS_DELIVERY_EMAIL=blog-delivery@example.com
   export CMS_PREVIEW_EMAIL=blog-preview@example.com
   cms_script() {
     docker run --rm --network game_node_app -v "$PWD/docker/cms:/cms:ro" \
       -e CMS_URL=http://blog-cms:8055 -e CMS_ADMIN_EMAIL -e CMS_ADMIN_PASSWORD \
       -e CMS_DELIVERY_EMAIL -e CMS_PREVIEW_EMAIL \
       -e BLOG_CMS_DELIVERY_TOKEN -e BLOG_CMS_PREVIEW_TOKEN \
       python:3.13-alpine python "/cms/$1"
   }
   cms_script setup.py
   # MYSQL_CONTAINER is the managed MySQL container (its Coolify UUID).
   docker exec -i "$MYSQL_CONTAINER" \
     sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root blog_cms' < docker/cms/model-constraints.sql
   cms_script provision-readers.py
   ```

   Use individual Directus accounts with the `Blog editor` role for human
   writers. The `Blog delivery` account reads only eligible published data; the
   `Blog preview` account can read drafts and private files but cannot write.
   Anonymous raw CMS content and asset reads are denied. The grant must be
   active before the filtered policies are provisioned.
4. Supply `BLOG_CMS_PUBLIC_URL`, `BLOG_CMS_DELIVERY_TOKEN`, and
   `BLOG_CMS_PREVIEW_TOKEN` to the application's deployment environment using
   the same values. The production Compose file connects the server to
   `http://blog-cms:8055` and mounts `gamenode-blog-public-media` read-only at
   `/app/blog-public-media`. Compose creates the published-media volume and
   the server waits for `cms-media-init` to set its ownership. Provision the
   CMS model and reader accounts before enabling blog traffic. These local
   volumes are shared on one host; a multi-host
   deployment needs shared storage with the same write/read-only separation.
5. Run the database migration only after checking the target database. It drops
   the five internal blog tables and their contents. The local development
   database contained two blog posts; at the owner's request the migration was
   applied there on 2026-10-28, with profile, game and post counts unchanged.
   Rollback recreates empty tables and cannot recover deleted records. Keep a
   database backup if another target contains anything needed.

The CMS limits uploads to 10 MB and one concurrent upload, permits JPEG, PNG
and WebP, bounds input/output image dimensions to 4096, limits transforms to
five operations and one concurrent transform with a 15-second timeout, and
retains revisions for 30 days. Prepared images are capped at 20 MiB. Private
staging files not referenced by published content are removed after one day.
Back up `blog_cms` and both asset volumes together; the MySQL instance backup
must also include `gamenode` and `supertokens`. Monitor disk
space: previously published media intentionally remains public and is not
removed when an article is unpublished.

## Public and preview contract

The server's versioned API provides:

- `GET /v1/blog/post?locale=en|pt-BR&tag=...&limit=...&offset=...` for the
  paginated published list; `GET /v1/blog/post/tags?locale=...` for visible
  tags; and `GET /v1/blog/post/:postId?locale=...` for one article. Locale
  defaults to English; unsupported locales return 400. Portuguese requests
  use a complete published English fallback when needed. Tags and counts are
  based on eligible articles before pagination.
- Public articles carry an ID, title, sanitized HTML, excerpt, author ID, tags,
  optional game/rating, explicit cover URL and alt, publication time, and
  requested, resolved and available locales. There is no public draft flag.
  Missing articles return 404, upstream failures return 503, and a successful
  empty archive remains empty.
- `GET /v1/blog/preview/:postId?locale=en|pt-BR` requires an authenticated
  ADMIN, MOD or EDITOR and an exact locale. It returns draft state without
  fallback and uses `Cache-Control: private, no-store`. Preview images go
  through an authenticated server route with the same cache policy.

On publication, CMS images are transformed into immutable public copies. The
API rewrites cover and inline references to explicit server URLs. Draft-only
originals and staging are private. A later replacement remains private until a
successful publication; already published copies remain accessible after
unpublication. If promotion is not yet complete, the public API returns 503
instead of a broken image URL. Never include a CMS token in an image URL.

## Verification

The Compose startup, grant, model, credentials, bilingual fallback, author/game
validation and cover/inline publication were exercised on an isolated MySQL 8.0
instance with new test content. The test ran the server delivery controllers
against the real CMS and used separate temporary storage and a fake reference
API. Focused HTTP tests also exercise real SuperTokens roles, draft denial,
locale fallback, safe HTML and upstream errors. The seven focused blog suites
passed (17 tests), as did the server build. An isolated full-server startup
check also verifies that the CMS routes appear in the exported OpenAPI. The
paired wrapper, web, mobile and admin checks remain outstanding. To repeat the full disposable
check, configure a disposable CMS to reach a test reference service at port
18081 and run `docker/cms/check-publication.py`; it creates and removes its
fixtures and must not target production.
