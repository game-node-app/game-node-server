# Proposal

## Why

GameNode promised supporters a video profile cover, but today the only animated option is an unconverted GIF avatar: large files, no size control, and GIF banners never animate because the client crop flattens them to JPEG. Converting on the server gives every client the same small, universally playable file, so web and mobile do not have to deal with encoder or browser incompatibilities.

## What Changes

- Add a supporter-only upload that accepts a video for the avatar or the banner and answers immediately while conversion runs in the background.
- Convert the video on the server to a small, silent, short H.264 MP4 and a JPEG poster. Only the converted files go to object storage (R2, S3 API); the source stays on temporary local disk during processing and is always removed.
- Expose the published video on profile reads and the upload status to the owner. The poster also becomes the regular avatar/banner image, so every existing consumer and old app version keeps working.
- Hide the video without deleting it when the owner stops being a supporter; the poster stays visible.
- Uploading a static image for a slot replaces and removes the video of that slot.
- **BREAKING**: `PUT /v1/profile/image` stops accepting GIF for new uploads. It accepts only PNG and JPEG, detected from the file content. Existing GIF avatars keep working.
- Harden the static image flow touched by this change: enforce the size limit during upload, keep the old image until the new one is saved, and delete replaced objects from storage. Account deletion also removes the profile's media objects.
- Generate a web/mobile client hand-off as the final task. Client implementation is not part of this change.

Not included: client UI, other supporter perks (badge, theme, avatar border, live profile, game covers), start-time trimming, a delete-video endpoint, presigned uploads, HLS, conversion of existing GIFs, and upload limits on posts (posts keep GIF).

## Capabilities

### New Capabilities

- `profile-media`: Rules for a profile's avatar and banner media: accepted image formats, supporter video upload, conversion, publication, exposure on reads, and storage cleanup.

### Modified Capabilities

None. `supporter-subscriptions` is only consumed through its existing `isSupporter` entitlement.

## Impact

- **API**: new `PUT /v1/profile/video`; additive video fields on `GET /v1/profile` and `GET /v1/profile/:id`; `PUT /v1/profile/image` rejects GIF and other non PNG/JPEG content, and returns 413 above its size limit.
- **Code**: `src/profile` (controller, service, new video service, queue processor, entity, DTOs), `src/upload/upload.service.ts` (stored-file save and delete), new migration.
- **Infrastructure**: `Dockerfile` installs ffmpeg; new BullMQ queue on the existing Redis; conversion shares the 4 vCPU VPS with the API, with no GPU.
- **Clients**: old builds that send a GIF receive an error. Web and mobile adopt the video through the hand-off.
