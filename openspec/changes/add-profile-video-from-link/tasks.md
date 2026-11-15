# Tasks

## 1. Request validation

- [ ] 1.1 Add the link DTO (`url`, `type`, optional crop) and a `parseProfileVideoLink` helper that parses the URL, enforces `https`, the host allowlist on label boundaries, and rejects credentials, ports and IP literals. Verify with unit tests for each allowed host and subdomain, look-alike hosts, `http`, userinfo, ports, IPv4 and IPv6 literals, internal names, empty and non-URL text.
- [ ] 1.2 Add `POST /v1/profile/video/link` behind `AuthGuard`, `SupporterGuard` and a stricter throttle, gated by `PROFILE_VIDEO_LINKS_ENABLED` (404 when off), claiming the slot and enqueuing the job. Verify with controller and service tests for 202, 400, 403, 404 (flag off) and 409.

## 2. Download

- [ ] 2.1 Add the `sourceUrl` field to `ProfileVideoJobData` and make the processor download first when it is set, then continue through the existing probe, conversion, poster and publication. Verify with processor tests that an upload job is unchanged and a link job calls the downloader exactly once.
- [ ] 2.2 Add the `yt-dlp` runner on top of `media-process.ts` with the limits in `design.md` (single video, 30 s, 64 MiB, 1080p, timeout, no cookies, job-directory home and cache), and verify with tests of the argument list and of the timeout kill using a fake binary.
- [ ] 2.3 Map downloader failures to `download_unsupported`, `download_too_large` and `download_failed`, delete the job directory on every path, and verify with tests that the published media is untouched on failure and that stderr is logged but never returned.

## 3. Contract and infrastructure

- [ ] 3.1 Extend the status error codes and DTOs, regenerate `server_swagger.json`, and verify the new route and codes appear.
- [ ] 3.2 Install the pinned `yt-dlp` standalone binary in the `Dockerfile` with a SHA-256 check, and verify with `docker build` that `yt-dlp --version` runs as the unprivileged user.
- [ ] 3.3 Document `PROFILE_VIDEO_LINKS_ENABLED` in `.env.example` and the deployment notes, and write `handoff-clients.md` for the clients change.

## 4. Verification

- [ ] 4.1 With the flag on, submit a public YouTube link as a supporter against a local server in the project's Docker image, and verify the slot goes `processing` then `ready` and the published video plays.
- [ ] 4.2 Submit a private video, a removed video, a non-allowlisted host and a playlist link, and verify each result matches the spec.
- [ ] 4.3 Run `yarn lint`, the unit tests and `yarn build`, and verify all pass.
