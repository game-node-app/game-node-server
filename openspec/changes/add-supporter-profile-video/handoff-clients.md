# Supporter profile video — client hand-off

Server implementation of the supporter profile video. Client rendering, upload UI and the mobile
autoplay check are a separate change in `game-node-clients`; this document only fixes the HTTP
contract and lists the client work it implies.

Regenerate the client from `server_swagger.json`. All routes are under `/v1` and use the normal
Better Auth session (cookie or `Authorization: Bearer <token>`); protected calls without a session
return 401.

## Contract

### `PUT /v1/profile/video` (supporter only)

`multipart/form-data`:

| Field | Required | Value |
| --- | --- | --- |
| `file` | yes | One video file, at most 64 MiB (`67,108,864` bytes) |
| `type` | yes | `avatar` or `banner` |
| `cropX`, `cropY`, `cropWidth`, `cropHeight` | no | Normalized `0..1` values for the visible frame, sent all together or not at all |

The crop applies to the source after autorotation, so a portrait phone video cropped by the
client's displayed preview matches what the server cuts. Without crop fields the server uses a
center crop. `cropX + cropWidth` and `cropY + cropHeight` must each stay at most 1; width and
height must be greater than 0. The server ignores any other field, and the client file name is never
used.

Success:

```http
202 Accepted
{ "status": "processing" }
```

Conversion runs in the background. The client must poll `GET /v1/profile` (see
`videoUploads`) until the slot is `ready` or `failed`. Uploading again to the same slot while it is
`processing` returns 409; the other slot can be uploaded at the same time.

Errors:

| Status | When |
| --- | --- |
| 400 | No file; `type` missing or not `avatar`/`banner`; crop partially sent, non-numeric or out of bounds; file content is not an acceptable video (see limits) |
| 401 | No valid session |
| 403 | Authenticated, but not a supporter |
| 409 | That slot already has a running attempt |
| 413 | Body/file above 64 MiB |
| 429 | More than 5 upload requests in 60 seconds (per client IP) |
| 500 | The conversion could not be queued |

An enqueue failure (500) marks the attempt as `failed` with `errorCode: "conversion_failed"` in
`videoUploads`; the source file is removed. The upload throttle is 5 requests per 60 seconds per
client IP. Requests rejected after the throttle is evaluated (403, 409, 500) consume the quota;
an unauthenticated 401 is rejected before it.

Accepted source, decided from file content (never from the declared mimetype or file name): MP4/MOV
or Matroska/WebM container; video stream encoded as H.264, HEVC, VP8, VP9 or AV1; no side longer
than 4096 pixels; a real video stream (audio-only and cover-art-only files are rejected). GIF is
rejected with 400.

Server output (fixed, not configurable by the client):

| Slot | Video | Budget |
| --- | --- | --- |
| `avatar` | 256x256 H.264 MP4 | 1 MiB |
| `banner` | 1280x548 H.264 MP4 | 5 MiB |

Output is silent, at most 8 seconds, at most 30 fps (never raised above the source), HDR sources are
tone mapped to SDR BT.709, and progressive download is enabled (`moov` before `mdat`). The source is
never stored in object storage; only the converted MP4 and its JPEG poster are.

### `GET /v1/profile` (owner)

The existing profile object gains:

```json
{
    "avatarVideo": {
        "filename": "ab12",
        "extension": "mp4",
        "mimetype": "video/mp4",
        "size": 812345,
        "durationMs": 8000,
        "width": 256,
        "height": 256
    },
    "bannerVideo": null,
    "videoUploads": {
        "avatar": { "status": "ready", "errorCode": null },
        "banner": null
    }
}
```

- `avatarVideo` / `bannerVideo` are the currently published video, or `null`. They are also `null`
  when the owner is no longer a supporter (the published video is kept, not deleted, and reappears
  when entitlement returns).
- `videoUploads` is owner-only and reports the last attempt of each slot:
  `status` is `processing`, `ready` or `failed`; `errorCode` is `null` or one of
  `conversion_failed`, `output_too_large`, `upload_failed`, `source_missing`, `timeout`.
  A slot with no attempt is `null`. An attempt older than 30 minutes is reported as
  `failed` / `timeout`; the owner may upload again.
- Success publishes the video and replaces `avatar` / `banner` with the video's JPEG poster, so old
  builds and every existing image consumer keep showing a current image. The poster is a normal
  image record (`extension` `jpeg`).

`GET /v1/profile/:id` is public and returns `avatarVideo` / `bannerVideo` for a supporter's
published video, but never `videoUploads`. Both routes return `null` video fields when there is no
published video or the entitlement lookup fails; the profile read still succeeds.

Build video URLs like the existing image URLs: `{uploadsBaseUrl}/{filename}.{extension}` (for a
video, `{filename}.mp4`), using the same bucket/base URL the client already uses for `avatar` and
`banner`.

### `PUT /v1/profile/image` (changed)

`multipart/form-data` with `file` and `type` (`avatar` or `banner`). Only PNG and JPEG content is
accepted, detected from the file bytes; the declared mimetype and file extension are not trusted.

- 400 for GIF (including a GIF renamed/declared as PNG), WebP, SVG and undecodable content. The
  current avatar/banner and video are unchanged.
- 413 above `10,240,000` bytes.
- 200 with an empty body on success.
- Saving a static image for a slot replaces and removes that slot's published video and cancels a
  running attempt. If storage or the save fails, the request fails (500) and the current image and
  video stay.
- Existing GIF avatars uploaded before this change keep being served; only new GIF uploads are
  rejected. Post uploads keep GIF.

## Client work (in `game-node-clients`)

The files and line references below come from the server design; they were not verified against the
client repository in this change.

Rendering (`packages/ui/src/components`): `general/avatar/UserAvatar.tsx`,
`profile/view/ProfileBanner.tsx`, `settings/tabs/profile/SettingsProfileImages.tsx`,
`supporter/settings/SupporterProfilePreview.tsx`, and `notifications/AggregatedNotification.tsx:268`
(it builds the URL without an extension and could use `UserAvatar`). Every rendering plays the
video with `muted loop playsinline` and the poster, mounting only near the viewport because
Chromium limits concurrent media players. Use the poster only for `prefers-reduced-motion` or when
autoplay is blocked.

Uploads: `profile/edit/ProfileEditAvatarUploader.tsx` (remove the GIF branch and accept entry at
lines 91 and 108), `ProfileEditBannerUploader.tsx` (its canvas crop cannot process video; send
normalized crop values instead), plus a supporter gate with upload and processing states.
`posts/editor/GamePostEditor.tsx` keeps GIF.

Mobile and copy: autoplay test on the Android WebView (`apps/mobile`, `minSdkVersion = 24`), old
builds that still send GIF receive 400, and `packages/locales` copy.

Client spec conflict: `redesign-supporter-settings` and `add-supporter-subscriptions` in the client
repo state "SHALL NOT gate features that are free today". Removing GIF for free users touches that
wording, so the client change must reconcile it.

## Not in this change

- No delete-video endpoint. A static image for the slot, or account deletion, removes the video.
- No client UI, no HLS, no trimming, no presigned uploads and no conversion of existing GIFs.
- This document contains no credential values.
