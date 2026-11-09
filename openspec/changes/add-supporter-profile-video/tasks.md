# Tasks

## 1. Foundation

- [x] 1.1 Install `ffmpeg` with `--no-install-recommends` in `Dockerfile` and verify `docker run <image> ffmpeg -filters` lists `zscale` and `tonemap` and that `prlimit` and `nice` exist in the image.
- [x] 1.2 Add the `ProfileVideo` entity and a raw-query migration for `profile_video` (design 4), register it in `ProfileModule`, and verify the migration runs up and down on a clean database with the unique key and cascade FK present.
- [x] 1.3 Add `saveStoredFile` and `delete` to `UploadService` without changing `save`, and verify with unit tests that the `PutObjectCommand` carries the immutable `Cache-Control` and content type and that `save` still behaves as before.

## 2. Conversion pipeline

- [x] 2.1 Implement the hardened process runner and `ffprobe` validation (design 5), with the `shortcut:` comment recording the same-container limit and the dedicated-container upgrade trigger; verify with tests that spawn args contain no shell, the environment holds only `PATH`, the whitelists are present, the timeout kills the process, and cover-art-only, audio-only, GIF, playlist and oversized inputs are rejected.
- [x] 2.2 Implement conversion and poster generation for both slots including crop, autorotation and HDR tone mapping; verify with a test using `ffmpeg` `lavfi`-generated samples (skipped with a logged reason when the binary is absent) that the output is H.264 yuv420p, the target size, at most 8 s and 30 fps, with no audio or metadata, `moov` before `mdat`, and rejected above budget.

## 3. Upload endpoint

- [x] 3.1 Add `SupporterGuard` and `PUT /v1/profile/video` with throttling, Multer `dest` and limits, handler-level parsing, probe, atomic claim and enqueue (design 2, 3, 4, 6); verify with controller tests for 202, 400, 401, 403, 409, 413 and 429, that guards reject before a file is written, and that every rejection and enqueue failure removes the temp file.
- [x] 3.2 Add the `profile-video` queue module with `attempts: 1`, using the existing test queue mocks, and verify the application boots with no new provider cycle and the job options are applied.

## 4. Worker and publication

- [x] 4.1 Implement the processor: attempt check, conversion, R2 upload, transactional publish guarded by `attemptId`, poster swap into `avatar`/`banner`, deletion of replaced objects, and `finally` cleanup; verify with tests for success, every `errorCode`, previous media preserved on failure, a superseded attempt deleting its uploads, and the temp directory removed in every case.
- [x] 4.2 Add the startup and hourly temp sweep and verify with a test that entries older than one hour are removed and newer ones are kept.

## 5. Profile reads

- [x] 5.1 Compose `avatarVideo`, `bannerVideo` and owner-only `videoUploads` in the `GET /v1/profile` and `GET /v1/profile/:id` handlers with a response DTO for Swagger (design 9); verify with tests for supporter, non-supporter, entitlement lookup failure, previous video during an attempt, stale attempt reported as `timeout`, status absent on the public route, and `isSupporter` not called for profiles without a video.

## 6. Static images and cleanup

- [x] 6.1 Restrict `PUT /v1/profile/image` to PNG/JPEG by detected content, add the Multer limit and verify with tests that real and renamed GIF, WebP and SVG return 400, oversized files return 413, and PNG/JPEG still succeed; verify that `src/posts` upload behavior is unchanged.
- [x] 6.2 Reorder `updateProfileImage` to store before detaching, delete the replaced object best effort and remove the slot's video row and objects after saving; verify with tests that a storage failure keeps the old image and video, an object deletion failure does not fail the request, and a running attempt is cancelled.
- [x] 6.3 Delete avatar, banner, poster and video objects after `deleteByUserId` commits, and verify with a test that objects are deleted only after commit and that the existing notifications lifecycle integration test still passes.

## 7. Spec check

- [x] 7.1 Run `openspec validate add-supporter-profile-video --strict` and compare each scenario in `specs/profile-media/spec.md` with a passing test or a recorded manual check, listing any gap in the change.

## 8. Integration

- [x] 8.1 Run `yarn build`, the unit suite and the affected integration suites, and verify they pass with the Docker image built from this change. **Owner decision on 2026-11-08: `src/mcp/mcp.controller.spec.ts` was removed instead of repaired; it needs a dev MySQL and was never confirmed passing with this change. The full unit suite was not rerun after that; playtime, profile, posts and upload specs and the typecheck were.**
- [x] 8.2 Convert real phone samples (H.264 and HEVC, HDR, portrait, 4K) in a container limited to the production CPU profile, record conversion time, CPU use and output sizes in `design.md`, adjust CRF/preset/bitrates while keeping the budgets, and verify the outputs play on Chromium, Firefox, Safari and an Android WebView and that a 64 MiB upload passes through the production proxy. **SKIPPED by the owner on 2026-11-08, NOT executed: it waits for the web client implementation. CRF, preset, bitrates, CPU impact, browser playback and the 64 MiB proxy path remain unmeasured.**

## 9. Client hand-off

- [x] 9.1 Regenerate `server_swagger.json` and write `handoff-clients.md` in this change with all contents listed in design 11, stating that client implementation is a separate change in `game-node-clients`; verify every endpoint, field, status and `errorCode` in the document matches the implemented DTOs and that the document contains no credential values.

## Workflow follow-up

- Archive the change after the hand-off is delivered and the implementation is reviewed.
