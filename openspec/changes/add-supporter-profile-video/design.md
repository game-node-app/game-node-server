# Design

## Context

See proposal.md for motivation and specs/profile-media/spec.md for behavior.

- Production is one `server` replica on a 4 vCPU VPS with no GPU, shared with Redis, Manticore and the other Compose services. The container runs as root (`Dockerfile` has no `USER`) and holds database, Stripe and S3 credentials.
- `UploadService.save` takes a Multer buffer, generates a random key and writes to R2. It has no delete.
- `PUT /v1/profile/image` has no Multer limit, so the whole body is buffered before `MaxFileSizeValidator`. Its `FileTypeValidator` trusts the client-declared mimetype. `ImageCompressorService` passes GIF and WebP through unchanged.
- `updateProfileImage` detaches the old image before storing the new one, and no flow deletes R2 objects.
- Clients build media URLs from `${filename}.${extension}`, and `UserAvatar` is used across the client, usually through a per-user profile fetch.
- BullMQ defaults in `AppModule`: `attempts: 3`, `removeOnFail: true`.
- Provider chain: `AuthService -> UserInitService -> ProfileService`, and `BillingService -> AuthService`.

## Goals / Non-Goals

**Goals:**

- A small, identical output for every client, produced without noticeable impact on API latency.
- No regression for consumers that know only `avatar` and `banner`.
- Bounded blast radius for hostile files.

**Non-Goals:**

- Sandboxing in a separate container or VM (see Risks for the upgrade trigger).
- Cost or playback optimization on the client.
- Moderation tooling for video. Static avatars have none today either.

## Decisions

### 1. Flow

```
PUT /v1/profile/video
  AuthGuard -> Throttle -> SupporterGuard -> multer(dest=tmp, 64 MiB)
    -> parse type/crop -> ffprobe -> claim row -> enqueue -> 202

worker (concurrency 1, attempts 1)
  check attempt -> ffmpeg mp4 -> poster -> assert budget -> put video + poster in R2
    -> DB commit if attempt still current -> delete replaced objects
  finally: remove job temp dir
```

Alternatives rejected: converting in the client (encoder and browser differences are what we want to avoid), converting to GIF (larger output than H.264 at the same quality), and storing the source in R2 first (extra round trips and storage for a file we discard).

### 2. Guard order protects the disk

`SupporterGuard` wraps `BillingService.isSupporter` and runs as a guard because guards run before `FileInterceptor`, so a non-supporter never writes a byte. Multer uses `dest` plus `limits: { fileSize: 64 * 1024 * 1024, files: 1 }`. 64 MiB leaves room under a possible proxy body limit; task 8.2 confirms a 64 MiB upload passes through the production proxy.

### 3. Validation happens inside the handler

The handler takes the raw body (`Record<string, string>`, documented with `@ApiBody`) and parses `type` and crop itself. A `ParseFilePipe` or DTO pipe failure would happen before the handler and skip the cleanup that the handler's `try/catch` provides. Any error after Multer removes the temp file. The periodic sweep remains the backstop.

`ffprobe` runs in the request. It is fast, gives immediate 400 feedback and spares a queue slot for a bad file. It uses the hardening of decision 5.

### 4. One row per slot, with publication separate from the attempt

New table `profile_video` with a unique key on `(profileUserId, type)` and a FK to `profile.userId` with `ON DELETE CASCADE`:

| Column | Meaning |
| --- | --- |
| `filename`, `size`, `durationMs`, `width`, `height` | Published video; null until the first success |
| `status` | Last attempt: `processing`, `ready`, `failed` |
| `attemptId` | Current attempt's UUID |
| `errorCode` | `conversion_failed`, `output_too_large`, `upload_failed`, `source_missing`, `timeout` |
| `processingStartedAt` | Used for the staleness check |

Keeping both on one row lets the old video stay public while a new attempt runs. Claiming is one conditional `UPDATE ... WHERE status <> 'processing' OR processingStartedAt < :stale` after ensuring the row exists; zero affected rows means 409. This closes the race between parallel uploads without a lock.

The worker publishes only if `attemptId` still matches, in the same transaction as the avatar/banner swap. If the row was cancelled or removed, the worker deletes what it uploaded. A static image upload and account deletion therefore need no coordination with the worker beyond removing the row.

Staleness is a timestamp check on read and claim, not a cron. Alternative rejected: a separate attempts table, which is more schema for one extra state.

### 5. Conversion

Software x264 only, as a child process, so the event loop and BullMQ lock renewal stay free.

```
nice -n 19 prlimit --as=<2 GiB> --cpu=<180 s>
ffmpeg -nostdin -hide_banner -loglevel error
  -protocol_whitelist file -format_whitelist mov,matroska -i <input>
  -map 0:v:<picked stream> -an -sn -dn -map_metadata -1 -map_chapters -1 -t 8
  -vf "<tonemap if HDR>,crop=<normalized>,fps=<min(source,30)>,scale=<W:H>,format=yuv420p"
  -c:v libx264 -preset veryfast -crf 28 -maxrate <r> -bufsize <2r> -threads 2
  -movflags +faststart -f mp4 <output>
```

| Slot | Output | maxrate | Budget |
| --- | --- | --- | --- |
| avatar | 256x256 | 900 kbit/s | 1 MiB |
| banner | 1280x548 | 4 Mbit/s | 5 MiB |

The banner height is 548 rather than 549 because yuv420p needs even dimensions; it stays at about 21:9, matching the current cropper. Normalized crop values apply after autorotation, through `iw`/`ih` expressions. After the crop, the scale fills the target and center-trims any rounding difference. An HDR source (`smpte2084` or `arib-std-b67`) uses a `zscale`+`tonemap` prefix to BT.709. The poster comes from the first frame of the converted MP4 as JPEG, so that step only decodes our own output.

The clock limit is 180 seconds, enforced with SIGKILL. CRF, preset and rates are starting points to confirm with real files (see task 8.2).

Hardening: `spawn` with an args array and no shell; an environment containing only `PATH`; generated paths only, never the client's file name; a per-job directory owned by uid 65534 and the process dropped to that uid when the server is root; `prlimit` and `nice` as above; stderr goes to logs and is never returned to clients. The `Dockerfile` installs `ffmpeg` with `--no-install-recommends`.

Alternative rejected for v1: a dedicated conversion container. It is the stronger boundary, but needs a shared volume or file transfer, another service to run on the same VPS and a deployment change. See Risks.

### 6. BullMQ queue

New queue `profile-video` following the `src/recap/queue` pattern (`WorkerHostProcessor`, `@Processor(..., { concurrency: 1 })`). Jobs are added with `attempts: 1`, overriding the default of 3 because the user can retry and re-running a bad file only burns CPU. Payload: temp path, user, slot, crop and `attemptId`. A single replica means the API and the worker share the temp disk.

If enqueueing fails, the handler marks the attempt failed, removes the file and responds 500. Temp files live under `os.tmpdir()/profile-video`; `onModuleInit` and an hourly `@Cron` remove entries older than one hour.

### 7. Object storage

`UploadService` gains two small methods, leaving `save` untouched: `saveStoredFile(userId, path, contentType)` streams a file with `Cache-Control: public, max-age=31536000, immutable`, and `delete(key)` removes one object. Video and poster each get a new random key, which makes immutable caching safe.

### 8. The poster is the regular image

On publication, a new `ProfileAvatar`/`ProfileBanner` row points at the poster and replaces the old one. No caller of `avatar`/`banner` needs to change, old app builds show the poster and entitlement loss leaves a sensible image in place.

### 9. Reads are composed in the controller

`findOwn` and `findOneById` call `ProfileVideoService`, which adds `avatarVideo`, `bannerVideo` and, for `findOwn` only, `videoUploads`. `ProfileService.findOneById` stays unchanged for its internal callers. `isSupporter` runs only for profiles with a published video, so the cost falls on supporters' profiles, not every read. No cache is added.

`ProfileVideoService` owns the `BillingService` dependency. `ProfileService` only uses the `ProfileVideo` repository for cleanup, which avoids a new `ProfileService -> BillingService -> AuthService -> UserInitService -> ProfileService` provider cycle.

Response fields:

```json
{
  "avatarVideo": { "filename": "ab12", "extension": "mp4", "mimetype": "video/mp4", "size": 812345, "durationMs": 8000, "width": 256, "height": 256 },
  "bannerVideo": null,
  "videoUploads": { "avatar": { "status": "ready", "errorCode": null }, "banner": null }
}
```

### 10. Static image flow

Content is checked with `sharp(buffer).metadata().format` against `jpeg` and `png`, which matches what the avatar uploader offers once GIF is removed. The check belongs in the handler path, with a Multer limit equal to the current 10,240,000 bytes. `updateProfileImage` becomes: store new, save the relation, delete the old row, delete the video row, then delete old objects best effort. Account deletion reads the filenames before its transaction and deletes the objects after commit.

### 11. Client hand-off contents

`handoff-clients.md`, in the style of the archived `add-supporter-subscriptions` hand-off, covers:

- **Contract**: `PUT /v1/profile/video` (multipart `file`, `type`, optional `cropX`, `cropY`, `cropWidth`, `cropHeight`), 202 body, status polling on `GET /v1/profile`, every error status and `errorCode`, limits, new read fields, URL construction, and the changed `PUT /v1/profile/image` errors (400 for GIF, 413 for size). Regenerate the client from `server_swagger.json`.
- **Rendering** (`game-node-clients`, `packages/ui/src/components`): `general/avatar/UserAvatar.tsx`, `profile/view/ProfileBanner.tsx`, `settings/tabs/profile/SettingsProfileImages.tsx`, `supporter/settings/SupporterProfilePreview.tsx`, and `notifications/AggregatedNotification.tsx:268` (it builds the URL without an extension and could use `UserAvatar`). Every rendering plays the video with `muted loop playsinline` and the poster, mounting only near the viewport because Chromium limits concurrent media players. Poster only for `prefers-reduced-motion` or blocked autoplay.
- **Uploads**: `profile/edit/ProfileEditAvatarUploader.tsx` (remove the GIF branch and accept entry at lines 91 and 108), `ProfileEditBannerUploader.tsx` (its canvas crop cannot process video; send normalized crop values instead), a supporter gate with upload and processing states. `posts/editor/GamePostEditor.tsx` keeps GIF.
- **Mobile and copy**: autoplay test on the Android WebView (`apps/mobile`, `minSdkVersion = 24`), old builds that still send GIF, and `packages/locales` copy.
- **Client spec conflict**: `redesign-supporter-settings` and `add-supporter-subscriptions` in the client repo state "SHALL NOT gate features that are free today". Removing GIF for free users touches that wording, so the client change must reconcile it.

## Risks / Trade-offs

- [Parser vulnerability in ffmpeg on a shared container] -> Supporter-only input, format and protocol whitelists, unprivileged uid, clean environment, resource limits. Network access from the container remains. Move conversion to a dedicated container if access widens beyond supporters or a relevant CVE appears.
- [CPU contention on 4 vCPU; the earlier estimate of conversion cost was an assumption] -> Concurrency 1, two threads, `nice -n 19`, per-user throttle, and measurement under task 8.2 before enabling in production.
- [Queue backlog delays a conversion past 30 minutes] -> Reported as `timeout`; the job can still publish if the attempt was not replaced.
- [Temp disk fills up] -> 64 MiB per file, one attempt per slot, supporter-only, cleanup in `finally`, hourly sweep.
- [Hidden video objects stay in R2 after entitlement loss] -> Bounded at 6 MiB per profile and required for reactivation.
- [Old clients send GIF after deploy] -> They receive 400. Accepted, and documented in the hand-off.
- [Best-effort deletion leaves orphans] -> Logged; a few orphaned objects are cheap.

## Migration Plan

1. The `server_migration` service creates `profile_video` before the server starts.
2. Deploy the image with ffmpeg. The video endpoint works once deployed; clients adopt it later, and read fields are additive.
3. Rollback: redeploy the previous image. The extra table is ignored. Published videos stay in R2, and posters keep working as images.

## Open Questions

- Final CRF, preset and bitrate values, set by the measurement in task 8.2 without changing the contract.
