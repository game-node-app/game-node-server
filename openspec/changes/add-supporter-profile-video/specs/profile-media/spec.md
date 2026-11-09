# Spec Delta

## Purpose

Defines how a profile's avatar and banner media are accepted, converted, published, exposed on reads and removed from storage, including the supporter-only video option.

## ADDED Requirements

### Requirement: Supporter video upload
An authenticated supporter SHALL be able to submit a video for the `avatar` or `banner` slot through `PUT /v1/profile/video`. The system SHALL evaluate authentication and supporter entitlement before writing any uploaded byte to disk.

#### Scenario: Supporter submits a valid video
- **WHEN** a supporter sends a valid video with type `banner`
- **THEN** the system responds 202 with status `processing`

#### Scenario: Non-supporter submits a video
- **WHEN** an authenticated user without supporter entitlement sends a video
- **THEN** the system responds 403 and no file is written

#### Scenario: Anonymous request
- **WHEN** an unauthenticated client sends a video
- **THEN** the system responds 401 and no file is written

### Requirement: Video upload request limits
The system SHALL stop reading an upload above 64 MiB and SHALL accept one file per request. The `type` field SHALL be `avatar` or `banner`. Crop fields SHALL be sent all together or not at all, as normalized values that stay inside the frame; without them the system SHALL use a center crop. Upload attempts SHALL be rate limited per client.

#### Scenario: File above the limit
- **WHEN** an upload exceeds 64 MiB
- **THEN** the system responds 413 and removes what was written

#### Scenario: Invalid slot
- **WHEN** the `type` field is neither `avatar` nor `banner`
- **THEN** the system responds 400 and removes the file

#### Scenario: Partial or out-of-bounds crop
- **WHEN** only some crop fields are sent, or `cropX + cropWidth` is greater than 1
- **THEN** the system responds 400 and removes the file

#### Scenario: Too many attempts
- **WHEN** a client exceeds the upload rate limit
- **THEN** the system responds 429 and no file is written

### Requirement: Video source validation by content
The system SHALL decide whether a source is acceptable from its content, never from the client-declared type or file name. A source SHALL have a video stream that is not cover art, in an MP4/MOV or Matroska/WebM container, encoded as H.264, HEVC, VP8, VP9 or AV1, with no side longer than 4096 pixels.

#### Scenario: Non-video content declared as video
- **WHEN** a file declared as `video/mp4` contains no decodable video stream
- **THEN** the system responds 400, removes the file and starts no conversion

#### Scenario: GIF submitted as video
- **WHEN** a GIF is sent to the video endpoint
- **THEN** the system responds 400 and removes the file

#### Scenario: Source above the dimension limit
- **WHEN** a video stream has a side longer than 4096 pixels
- **THEN** the system responds 400 and removes the file

#### Scenario: Audio-only container
- **WHEN** an MP4 contains only audio and cover art
- **THEN** the system responds 400 and removes the file

### Requirement: Conversion before publication
The system SHALL publish only the converted output, never the source. The output SHALL be an H.264 MP4 playable from a progressive download, without audio or source metadata, at most 8 seconds long and at most 30 frames per second, using the 8-bit 4:2:0 pixel format with SDR color.

#### Scenario: Long source with audio and location metadata
- **WHEN** a 40 second video with audio and location metadata is converted
- **THEN** the published MP4 lasts at most 8 seconds and has no audio stream or location metadata

#### Scenario: HDR source
- **WHEN** the source uses an HDR transfer function
- **THEN** the published MP4 uses SDR BT.709 color

#### Scenario: Source object never stored
- **WHEN** a conversion finishes, successfully or not
- **THEN** object storage does not contain the source file

### Requirement: Converted video size per slot
An `avatar` output SHALL be 256x256 and at most 1 MiB. A `banner` output SHALL be 1280x548 and at most 5 MiB. Frame rate SHALL NOT be raised above the source's. An output above its budget SHALL fail the attempt and SHALL NOT be published.

#### Scenario: Avatar output
- **WHEN** an avatar conversion succeeds
- **THEN** the published video is 256x256 and at most 1 MiB

#### Scenario: Output above budget
- **WHEN** the converted banner is larger than 5 MiB
- **THEN** the attempt fails with `output_too_large` and nothing is published

### Requirement: Asynchronous conversion and status
The system SHALL allow one running conversion per profile and slot and SHALL process conversions one at a time across the server. The owner SHALL be able to read the status of the last attempt of each slot on `GET /v1/profile`. An attempt running for more than 30 minutes SHALL be reported as failed with `timeout` and SHALL NOT block a new upload.

#### Scenario: Second upload while the slot is processing
- **WHEN** the owner uploads a video for a slot with a running attempt
- **THEN** the system responds 409 and removes the new file

#### Scenario: Other slot while one is processing
- **WHEN** the owner uploads a banner while an avatar attempt is running
- **THEN** the banner is accepted and queued

#### Scenario: Owner polls status
- **WHEN** the owner reads `GET /v1/profile` during processing
- **THEN** the response reports that slot as `processing`

#### Scenario: Status is private
- **WHEN** another user reads `GET /v1/profile/:id`
- **THEN** the response contains no upload status

#### Scenario: Abandoned attempt
- **WHEN** an attempt started more than 30 minutes ago and never finished
- **THEN** the owner sees `failed` with `timeout` and can upload again

### Requirement: Failed attempts preserve current media
A failed, abandoned or superseded attempt SHALL NOT change the slot's published video or image. The owner SHALL receive a stable error code and the attempt SHALL NOT be retried automatically.

#### Scenario: Conversion failure with an existing video
- **WHEN** an attempt fails for a slot that already has a published video
- **THEN** the previous video and image remain visible and the status is `failed` with an error code

#### Scenario: Attempt superseded by a static image
- **WHEN** the owner saves a static image for a slot while its video is converting
- **THEN** the conversion result is discarded and its objects are not left in storage

### Requirement: Video publication
When an attempt succeeds, the system SHALL store the video and poster before changing the profile, and SHALL then make the new video and the poster current together. The poster SHALL become the slot's regular image, so clients that do not know about video keep showing a current image.

#### Scenario: Successful publication
- **WHEN** an avatar conversion succeeds
- **THEN** `avatarVideo` returns the new video and `avatar` returns its poster

#### Scenario: Storage failure during publication
- **WHEN** storing the video or poster fails
- **THEN** the status is `failed` with `upload_failed` and the profile media is unchanged

### Requirement: Temporary source handling
Source files SHALL exist only on temporary local disk while being validated or processed. The system SHALL remove the source after rejection, success or failure, and SHALL periodically remove temporary files left by interrupted work. A job whose source no longer exists SHALL fail with `source_missing`.

#### Scenario: Conversion finishes
- **WHEN** a conversion succeeds or fails
- **THEN** its source and intermediate files no longer exist on disk

#### Scenario: Restart interrupts processing
- **WHEN** a restart leaves a temporary file behind
- **THEN** the file is removed by the startup or periodic cleanup

#### Scenario: Source lost before processing
- **WHEN** a queued job runs and its source is gone
- **THEN** the attempt fails with `source_missing`

### Requirement: Untrusted media processing limits
Processing of uploaded video SHALL treat the file as hostile. It SHALL run without a shell, without the server's environment secrets, without elevated privileges when the server has them, without access to anything but local input and output files, and within CPU, memory and wall-clock limits. Failures SHALL NOT expose tool output to clients.

#### Scenario: Playlist referencing a remote URL
- **WHEN** an upload is a playlist or container that references remote or other local files
- **THEN** the system does not read those references and rejects the file

#### Scenario: Conversion exceeds its time limit
- **WHEN** a conversion exceeds its wall-clock limit
- **THEN** the process is killed and the attempt fails with `conversion_failed`

#### Scenario: Malicious file name
- **WHEN** the uploaded file name contains shell metacharacters or path segments
- **THEN** the name is not used in any path or command

### Requirement: Video exposure on profile reads
`GET /v1/profile` and `GET /v1/profile/:id` SHALL return `avatarVideo` and `bannerVideo` with the published video's details when the profile owner is a supporter, and `null` otherwise. A failure to determine entitlement SHALL hide the video and SHALL NOT fail the profile read.

#### Scenario: Supporter profile with a video
- **WHEN** anyone reads a supporter's profile with a published banner video
- **THEN** `bannerVideo` contains its file name, `mp4` extension, size, duration and dimensions

#### Scenario: Profile without a video
- **WHEN** a profile has no published video
- **THEN** both video fields are `null`

#### Scenario: Previous video during a new attempt
- **WHEN** the owner is converting a replacement video
- **THEN** reads keep returning the previously published video

#### Scenario: Entitlement lookup fails
- **WHEN** the entitlement lookup throws during a profile read
- **THEN** the profile is returned with null video fields

### Requirement: Entitlement loss hides video
When the owner is no longer a supporter, the system SHALL hide the published video on reads while keeping the poster visible as the regular image and SHALL keep the video object. If entitlement returns, the video SHALL be shown again without a new upload.

#### Scenario: Subscription expires
- **WHEN** a user with a published video loses supporter entitlement
- **THEN** the video fields are `null` and `avatar` and `banner` still return the posters

#### Scenario: Subscription returns
- **WHEN** the user regains entitlement
- **THEN** the previously published video is returned again

### Requirement: Static image replaces the slot's video
Saving a static image through `PUT /v1/profile/image` SHALL replace the slot's published video and cancel any running attempt for that slot, once the new image is saved.

#### Scenario: Static banner over a video banner
- **WHEN** the owner saves a static banner while having a published banner video
- **THEN** `bannerVideo` becomes `null` and the video object is removed

#### Scenario: Static upload fails
- **WHEN** saving the static image fails
- **THEN** the current image and video remain unchanged

### Requirement: Static profile image formats
`PUT /v1/profile/image` SHALL accept only PNG and JPEG, determined from the file content. It SHALL NOT accept GIF for new uploads. Existing GIF images SHALL remain served. Other upload features SHALL keep their current formats.

#### Scenario: GIF upload
- **WHEN** a user uploads a GIF as avatar
- **THEN** the system responds 400 and the current avatar is unchanged

#### Scenario: GIF renamed and declared as PNG
- **WHEN** a file with GIF content is declared as `image/png`
- **THEN** the system responds 400

#### Scenario: WebP or SVG upload
- **WHEN** a user uploads WebP or SVG content
- **THEN** the system responds 400

#### Scenario: Existing GIF avatar
- **WHEN** a profile has a GIF avatar uploaded before this change
- **THEN** reads keep returning it unchanged

#### Scenario: GIF in a post
- **WHEN** a user uploads a GIF to a post
- **THEN** the post upload behaves as before

### Requirement: Static image upload safety
The system SHALL stop reading a static image above its existing 10,240,000 byte limit instead of buffering it whole. A failed save SHALL keep the slot's current image.

#### Scenario: Image above the limit
- **WHEN** an image upload exceeds the limit
- **THEN** the system responds 413

#### Scenario: Storage failure
- **WHEN** storing the new image fails
- **THEN** the system responds with an error and the previous image remains current

### Requirement: Profile media object cleanup
The system SHALL remove replaced avatar, banner, video and poster objects from storage after the replacement is committed. Account deletion SHALL remove the profile's media objects after its database deletion commits. Cleanup failures SHALL be logged and SHALL NOT fail the operation.

#### Scenario: Image replaced
- **WHEN** a new avatar is committed
- **THEN** the previous avatar object is deleted

#### Scenario: Account deleted
- **WHEN** an account with an avatar and a video is deleted
- **THEN** their objects are deleted and any running attempt publishes nothing

#### Scenario: Object deletion fails
- **WHEN** deleting a replaced object fails
- **THEN** the failure is logged and the new media stays current
