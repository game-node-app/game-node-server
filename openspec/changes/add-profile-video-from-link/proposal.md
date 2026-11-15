# Proposal

## Why

Supporters can only set an avatar or banner video by uploading a file from their device. Most people have the clip they want as a link (YouTube, TikTok, Instagram, X), and the Echo app already lets users paste such a link and downloads it for them. On the web a browser cannot do this itself: CORS blocks the download and there is no `yt-dlp`. The server is the only place that can fetch the video, and it already owns the conversion pipeline that turns a source into the small, bounded MP4 clients play.

## What Changes

- Add `POST /v1/profile/video/link` for supporters. It takes the same slot (`type`) and optional normalized crop as the file upload, plus a `url`.
- Accept only links on an allowlist of hosts: `youtube.com`, `youtu.be`, `tiktok.com`, `instagram.com`, `x.com` and `twitter.com`, including their subdomains. Reject everything else with 400 before any network access.
- Download the video in the existing `profile-video` worker with `yt-dlp`, then run it through the same ffmpeg conversion, poster generation, publication and cleanup as an uploaded file. Clients see the same `processing`, `ready` and `failed` states.
- Bound the download: first 30 seconds at most, a 64 MiB size cap, a height cap, no playlists, a wall-clock timeout, and the same sandboxing (unprivileged user, `nice`, `prlimit`, clean environment, per-job directory) as ffmpeg.
- Add error codes `download_failed`, `download_unsupported` and `download_too_large` to the status.
- Install a pinned `yt-dlp` standalone binary in the `Dockerfile`, verified by checksum, and add a switch (`PROFILE_VIDEO_LINKS_ENABLED`) so the feature can be turned off without a deploy.
- Reuse the supporter guard, the per-slot claim that returns 409 while processing, and the throttle.

Out of scope: arbitrary URLs and direct file links, playlists and live streams, private or age-restricted videos (no cookies are ever used), downloading audio, and a delete-video action.

## Capabilities

### New Capabilities

- `profile-media-link`: Setting a profile video from a link, the host allowlist, the download limits and the failure codes.

### Modified Capabilities

None. The upload flow in `add-supporter-profile-video` is unchanged; this change adds a second way to start the same job.

## Impact

- **Code**: a new controller route and service method in `src/profile/profile-video/`, a link-download step in the worker (`profile-video.processor.ts`), the process runner in `media-process.ts`, job data (`ProfileVideoJobData` gains a source URL), and the status error codes and swagger.
- **Infrastructure**: `Dockerfile` (`yt-dlp` binary), a new environment variable, and more outbound traffic and CPU on the single 4 vCPU VPS.
- **Clients**: need a new input and one new generated service method; see `add-profile-video-link-input` in `game-node-clients`.
- **Risk to flag**: these platforms' terms of service forbid downloading videos outside their own apps. The Echo app carries the same warning and treats it as personal use. A public service takes on more exposure, which is why the feature is supporter-only and switchable.
