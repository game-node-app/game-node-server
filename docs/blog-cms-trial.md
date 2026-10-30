# Blog CMS trial

Editorial acceptance passed. Local CMS-only resource results are recorded below; VPS validation is outside the user-approved scope.

## Baseline and version (2026-10-28)

Owner reports two people, zero revenue; owner will evaluate the writing workflow.
Intended host: 4 vCPU, 8 GB RAM, 100 GB expandable SSD, 200 Mbit/s port.
Local Docker reports 16 CPUs and 15.6 GiB RAM: local checks do not prove host fit.

Pinned image: `directus/directus:12.6.0`.
[Version license](https://github.com/directus/directus/blob/v12.6.0/license):
MSCL-1.0-GPL permits internal CMS use; GameNode does not offer a competing CMS.
The trial uses Core without paid features or SSO. Documented Core limits:
3 Studio seats, 25 collections, 5 flows. API-only accounts do not consume seats.
The proposed blog model fits these limits. Two people and zero revenue also meet
the published Open Innovation Grant size criteria (under $5M annual revenue and
fewer than 50 employees); grant activation is separate and not assumed.
Sources: [licensing](https://directus.com/docs/licensing/overview),
[limits](https://directus.com/pricing).

[Supported databases](https://directus.com/docs/self-hosting/requirements) include
SQLite. The trial uses the pinned image's bundled SQLite driver and its own volume.
Local private assets use a separate volume and container filesystem permissions;
no application S3 credentials, MySQL databases or community uploads are shared.

## Local startup and automated checks

From the repository root:

1. Set `CMS_SECRET` and `CMS_ADMIN_PASSWORD` in the root `.env` and restrict that
   file to mode 600. Never commit credentials.
2. `yarn start:dev:docker` starts the API and all local dependencies, including
   the CMS on http://localhost:8055, after their health checks pass.
3. `python3 docker/cms/trial.py`
4. Open http://localhost:8055 using `CMS_ADMIN_EMAIL` and `CMS_ADMIN_PASSWORD`
   from the root `.env`.

Keep the credentials in the ignored root `.env` file. Only loopback is exposed;
this is not a production HTTPS deployment.
`docker compose down` stops the complete local stack and preserves named volumes.
Adding `-v` removes all its data, including CMS content and application databases.

The assert-based check creates disposable bilingual review-shaped records and a
PNG, checks anonymous record/media denial, restarts the CMS and checks record and
image-byte persistence. Re-running adds records. The fixture collection is not
the adopted linked article/translation model.

## Writer acceptance: passed (owner-reported)

The owner inspected the Studio screen and confirmed the expected editorial fields
are present and appear suitable. They noted that locale is a free-text field,
without completion. This confirms initial UI suitability; it does not yet record
edit/save/render, image editing or revision recovery results.

Acceptance checklist exercised by the owner in `cms_trial_articles`:

- Edit formatting, links, accented text and inline images; save/reopen and record
  whether HTML and rendered editor output meet expectations.
- Publish English while leaving Portuguese draft; save/reopen both and verify states.
- Upload a real cover, exercise image editing/cropping and inspect the saved result.
- Save an incorrect paragraph, recover the prior revision through activity/revisions,
  and check the other language's state is unaffected.
- Record pass/fail and whether this workflow is acceptable for writing.

The trial grants no public delivery permissions. Linked translation UI, publication
hooks, NestJS sanitization and public rendering still require subsequent checks.

## Local CMS resource test

The owner explicitly replaced the proposed whole-host capacity gate with a local
CMS-only measurement. Other services, combined GameNode load and VPS capacity
are excluded. No host RAM/headroom or application latency regression claims are made.

Run from the repository root; the same root `.env` supplies the CMS credentials:

```
docker compose --env-file .env -p gamenode-cms-load --profile cms-load up -d --wait cms-load
python3 docker/cms/resources.py
```

This creates a separate `gamenode-cms-load` project on port 8056 using the
`cms-load` profile in the root Compose file, MySQL 8.0, Directus 12.6.0, a
dedicated test database and asset volumes. The SQLite editorial trial on port
8055 is unchanged. Only generated resource fixtures are
publicly readable, bound to loopback; this is not the adopted publication model.
The load runner executes outside the CMS container and measures only that container.

Workload: 100 published synthetic articles (~12 KB HTML each), 30 seconds idle,
20 seconds each of 1/5/10/20 concurrent list readers (10 articles per response),
20 seconds of edits with 500 ms pauses, 15 seconds of 1024×768 PNG uploads plus
640×480 thumbnail generation with one-second pauses, then 20 seconds idle.
Images are random pixels (~2.25 MiB), not repeated tiny thumbnails. Upload fixtures
are deleted afterward; test articles remain in the dedicated benchmark database.

Docker stats are sampled every second. Memory is working set (usage minus inactive
file cache); CPU 100% means one occupied core. The cgroup high-water memory value
includes startup and allocator/cache overhead, so it differs from sampled working
set. Startup-to-ready is derived from container start and the server-ready log.

Local checks require successful requests, no monitor failures, no OOM or unexpected
restarts, and working set below the configured 1 GiB limit. CPU saturation is reported,
not hidden as a pass. These short runs measure CMS consumption, not sustained VPS
capacity. MySQL's consumption and network/WAN latency are excluded.

Outputs: `docker/cms/resources.local.json`; a failed initial attempt is preserved in
`docker/cms/resources.first-run.json`. The first generator opened a fresh connection
for every request and saw resets; the revised runner reuses a connection per worker,
counts all errors without retries, and avoids unbounded error logs.

Stop only benchmark services when finished:

```
docker compose --env-file .env -p gamenode-cms-load --profile cms-load down
```

Volumes survive; `down -v` destroys only the benchmark database/assets.

## Observed results (2026-10-28)

Compose validation and the assert-based trial passed: bilingual records, PNG upload,
anonymous record/asset denial, and authenticated record/image persistence after
restart. Local idle sample: 197.5 MiB RAM of the 1 GiB cap, 0.55% CPU. This is
not a workload benchmark. Writer acceptance was subsequently confirmed by the owner (see follow-up below);
the owner subsequently replaced whole-host load validation with the local test above.

Pulled image digest: `sha256:5a475c31cf547da604b3ef1bd85097145825ca6aab8841dc784bb08eaa21681b`.

Trial follow-up: owner reported FORBIDDEN on Studio article creation. API create
and update succeed with the configured admin account; failing Studio payload
is still needed to reproduce the difference. The original PNG fixture was
invalid for image decoding despite byte persistence passing. Replaced it with
a valid PNG, repaired only the matching fixture asset and verified a Studio
thumbnail. The trial check now includes thumbnail rendering and article updates.

Save failure resolved: the supplied Studio payload included `id: "1"` for a
UUID primary key. Reproduced HTTP 403 with that payload; the same article saved
and read back successfully when the CMS generated its UUID. The fixture ID field
is now hidden/read-only in Studio, both on the running instance and repeatable
trial setup. Saved the supplied content as a private draft
(`43773f36-adeb-4842-843e-14d8c24a24e8`), verified all supplied content fields and
anonymous denial. Trial checks now also assert generated IDs parse as UUIDs.
This save fix alone did not complete writer acceptance or resource validation.

Owner acceptance follow-up: after the UUID form correction, the owner confirmed
that all requested editorial tests passed and the interface is suitable. Recorded
as owner-reported acceptance of independent publication, image editing, revision
recovery and HTML edit/save/render. This does not imply capacity or integrated
NestJS/client acceptance; those checks remain pending. Task 1.3 is complete.

Benchmark setup note: the Core license rejected creation of a filtered public
permission. The disposable benchmark therefore exposes only its generated
published-only fixture collection, with no drafts or user editorial content.
This measures read cost, not final publication-policy correctness.

## Local resource result (2026-10-28)

Final measured phases passed: zero request/monitor errors, no OOM and no
unexpected restarts. Initial cold startup (including CMS schema installation):
61.66 seconds. Cgroup lifetime memory high-water: 437.31 MiB; maximum sampled
working set: 365.94 MiB. CPU saturated the one-core cap under unpaced reads.

| Phase | Peak working set (MiB) | Mean CPU (% of one core) | Operations/s | p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| idle | 287.59 | 1.09 | 0.00 | — |
| public_reads_1 | 308.18 | 94.54 | 211.97 | 6.05 |
| public_reads_5 | 348.70 | 99.98 | 258.03 | 37.85 |
| public_reads_10 | 365.94 | 99.94 | 253.04 | 76.16 |
| public_reads_20 | 360.46 | 100.18 | 227.16 | 201.72 |
| edit | 357.39 | 3.00 | 1.92 | 24.25 |
| upload_and_thumbnail | 348.78 | 23.07 | 0.90 | 246.15 |
| recovery_idle | 335.79 | 1.00 | 0.00 | — |

The first attempt failed with connection resets when opening a fresh TCP
connection for every request. Preserved its error counts in the first-run report.
The final runner reuses connections per worker and does not retry failed requests.
Its post-measurement cleanup initially hit an idle keep-alive timeout; metrics
were already saved. Cleanup was corrected to reconnect, and all 14 generated
uploads were removed successfully. No editorial trial content was changed.

Task 1.4 is complete for the owner-approved local CMS-only scope. This does not
certify VPS capacity, total-stack memory, MySQL 8.3 compatibility or final
NestJS publication/preview correctness.

## Model setup in progress

On 2026-10-28 an isolated Directus 12.6.0 SQLite instance activated the Open
Innovation Grant license with `PUBLIC_URL=http://localhost:8059`. Server info
reported the environment license source and OIG entitlement. An administrator
created a custom policy and a filtered read permission successfully. The key
was supplied privately; the instance was discarded after the check. The Core
trial observations above remain historical and do not describe this grant.

`docker/cms/setup.py` creates the initial article, translation, tag and join
collections and a collection-level Blog editor role. Source the root `.env` and
set `CMS_URL` to `BLOG_CMS_URL` before running it:

```sh
set -a
. .env
set +a
export CMS_URL="$BLOG_CMS_URL"
python3 docker/cms/setup.py
```

Apply `docker/cms/model-constraints.sql` to the dedicated MySQL
CMS database after setup, then run `docker/cms/check-publication.py` with the same
environment to exercise locale uniqueness and anonymous denial. Both setup and
the SQL constraint were rerun against the local MySQL benchmark database.

The development and production Compose files mount the publication and media
hooks and the GameNode game picker; set
`BLOG_REFERENCE_API_URL` to the GameNode API's container-reachable `/v1` URL.
Editors can search the existing game catalog in the article's game field;
publication fails closed if the reference API is unavailable. The disposable
`check-publication.py` check uses a local fake reference API on port 18081;
configure the trial CMS URL accordingly before running it.

The setup also creates separate `Blog delivery` and `Blog preview` roles with
no Studio access. Preview can additionally read private CMS files. Create
separate Directus users for these roles and give each a different static token;
store them only as server secrets (`BLOG_CMS_DELIVERY_TOKEN` and the preview
secret), never in URLs or client configuration. Assign human writers the
`Blog editor` role using individual Studio accounts. Keep the CMS origin and
these accounts private. With the grant enabled, setup filters delivery access
to published translations. Public API handlers must also apply publication
checks. Run
`docker/cms/check-roles.py` with the same admin environment as setup to test
read-only roles and anonymous denial. Run `docker/cms/provision-readers.py`
with `CMS_DELIVERY_EMAIL`, `CMS_PREVIEW_EMAIL`, `BLOG_CMS_DELIVERY_TOKEN`, and
`BLOG_CMS_PREVIEW_TOKEN` set privately to provision distinct service accounts.
On the grant-enabled MySQL trial, `check-publication.py` confirmed duplicate
locale rejection and that a
delivery user sees published English but not draft Portuguese, while the
preview user sees both. The check also covers direct and nested translation
access, draft-only article/tag denial, and mutation denial for delivery.

On 2026-10-28 the adopted production Compose configuration was started with
isolated test volumes, a separate test network and MySQL 8.0. The grant was
active, provisioning and the uniqueness constraint succeeded, and newly
authored English and Portuguese content passed publication and media checks.
The server controllers read the real CMS and served the published cover and
inline image. A read-only mount of the public media volume rejected writes.
The reference API was a disposable local test service; this did not validate
VPS capacity or the paired clients.
