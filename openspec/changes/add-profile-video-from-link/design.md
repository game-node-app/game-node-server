# Design

## Context

- `add-supporter-profile-video` (merged) converts an uploaded file: `PUT /v1/profile/video` writes the multipart file to a per-job temp directory, probes it with `ffprobe`, claims the `(profile, type)` row, enqueues a BullMQ job and answers 202. The worker (`concurrency: 1`, `attempts: 1`) runs ffmpeg under `nice` and `prlimit` as an unprivileged user, builds a poster, uploads both to R2 and publishes only if the attempt is still current.
- Production is one `server` replica on a 4 vCPU VPS with no GPU, shared with Redis, Manticore and the other services. The container runs as root and holds the database, Stripe and S3 credentials.
- The Echo app downloads pasted links with `yt-dlp` on the device. A web client cannot, so the server has to.

## Goals / Non-Goals

**Goals:**

- A supporter can paste a YouTube, TikTok, Instagram or X link and get the same published, converted video as with an upload.
- Reuse the existing claim, queue, conversion, publication and cleanup, so there is one way a video reaches storage.
- Keep the server from becoming a general-purpose fetcher.

**Non-Goals:**

- Fetching arbitrary URLs or direct file links.
- Cookies, accounts, private or age-restricted videos.
- Keeping `yt-dlp` perfectly current automatically.

## Decisions

**Allowlist at the edge, not a blocklist.** The request is rejected unless it is an `https` URL on a short list of hosts (with subdomains matched on the label boundary, so `youtube.com.example.net` fails). Credentials, ports and IP literals are rejected. Validation uses the parsed `URL`, never string prefixes, and the same check runs again inside the worker before spawning the downloader. A blocklist of internal ranges was rejected: the allowlist already removes the SSRF surface of the request itself, and the redirect and resolution behavior of `yt-dlp` is left to its own extractor logic, which only talks to these platforms.

**The download happens in the worker, not in the request.** A download can take tens of seconds and must not hold an HTTP connection or bypass the queue's concurrency of one. The route validates, claims the slot and enqueues with `{ userId, type, sourceUrl, crop, attemptId }`; the worker downloads into the job directory and then follows the existing path (probe, convert, poster, publish). The `ffprobe` that gives immediate 400s for uploads therefore runs after the download, and its failures arrive as `failed` status codes instead.

**One job payload, two sources.** `ProfileVideoJobData` gets an optional `sourceUrl`; a job has either `sourcePath` (upload) or `sourceUrl` (link). The processor downloads first when `sourceUrl` is set and then continues with the resulting path, so conversion, publication and cleanup are shared and stay in one place.

**Download limits.** `yt-dlp` runs with `--no-playlist`, `--no-cache-dir`, `--ignore-config`, `--no-mtime`, `--max-filesize 64M`, `--socket-timeout`, `--retries 2`, `--download-sections "*0-30"` and a format selector capped at 1080 pixels (`bv*[height<=1080]+ba/b[height<=1080]/b`; the audio is dropped later by the conversion). It never gets a cookie file. The job directory is the only writable location, and a wall-clock timeout kills the process group (SIGKILL), like ffmpeg.

**Same sandbox as ffmpeg.** `media-process.ts` already spawns with an args array, no shell, a clean environment containing only `PATH`, `nice -n 19`, `prlimit` limits and a drop to uid 65534 when running as root. The downloader reuses that runner with larger file and clock limits, plus network access (which ffmpeg does not need). `HOME` and the cache point into the job directory.

**Pinned binary, checked at build.** The `Dockerfile` downloads a specific `yt-dlp` standalone release for Linux and verifies its SHA-256 before installing it. Extractors break often, so a stale binary will show up as `download_failed`; updating means bumping the pinned version and checksum in a deploy. An in-container self-update was rejected because it runs unreviewed code as root.

**Error codes.** `download_unsupported` (private, removed, age-restricted, live, image-only or no video), `download_too_large` and `download_failed` (anything else). They extend the status's `errorCode` set and the generated swagger. Stderr is logged and never returned.

**Kill switch.** `PROFILE_VIDEO_LINKS_ENABLED` defaults to off. When it is not `true` the route answers 404, so the feature can be disabled quickly if the platforms or the legal exposure change.

**Throttle.** The existing upload throttle applies, with a stricter limit for link submissions because each one costs a download.

## Risks / Trade-offs

- [The platforms' terms forbid downloading outside their apps] → Supporter-only, a kill switch, a documented decision, and no cookies or circumvention of private content.
- [`yt-dlp` breaks when a site changes] → Pinned version bumped in a deploy; failures surface as `download_failed` and leave the current media in place.
- [A downloader is a large attack surface running next to credentials] → Unprivileged user, clean environment, per-job directory, `prlimit`, host allowlist, no cookies; the upgrade path (a separate container) is the same as for ffmpeg.
- [Downloads and conversion compete for the same 4 vCPUs] → One job at a time, `nice 19`, 30-second cap and a 64 MiB limit.
- [Instagram and X often require a login] → Those links fail as `download_unsupported`; the allowlist still lists them because public posts work.

## Migration Plan

1. Merge with the flag off and deploy the new image.
2. Verify with a public YouTube link in a staging or local environment.
3. Switch `PROFILE_VIDEO_LINKS_ENABLED=true`, then ship the client change.
4. Rollback by turning the flag off; no data migration is involved.

## Open Questions

- Should the feature stay limited to YouTube and TikTok at launch, given how often Instagram and X need a login?
- Is a 30-second source cap right when the output is limited to 8 seconds, or should the client choose the start offset?
