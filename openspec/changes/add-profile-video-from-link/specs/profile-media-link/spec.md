# Spec Delta

## Purpose

Defines how a supporter sets an avatar or banner video from a link, which links are accepted, how the download is bounded, and how failures are reported.

## ADDED Requirements

### Requirement: Link submission
The server SHALL accept `POST /v1/profile/video/link` from supporters with a `url`, a slot `type` (`avatar` or `banner`) and an optional normalized crop (all four fields or none). It SHALL answer 202 with the same body as the file upload and process the video asynchronously through the same conversion pipeline.

#### Scenario: Valid link
- **WHEN** a supporter submits an allowed link for the banner
- **THEN** the server answers 202, marks the slot `processing`, and publishes a converted video and poster when the job succeeds

#### Scenario: Not a supporter
- **WHEN** a signed-in user who is not a supporter submits a link
- **THEN** the server answers 403 and does not contact any external host

#### Scenario: Slot already processing
- **WHEN** the slot already has a job in progress
- **THEN** the server answers 409 and starts no second download

#### Scenario: Feature switched off
- **WHEN** `PROFILE_VIDEO_LINKS_ENABLED` is not `true`
- **THEN** the endpoint answers 404 as if it did not exist

### Requirement: Host allowlist
The server SHALL accept only `https` URLs whose host is `youtube.com`, `youtu.be`, `tiktok.com`, `instagram.com`, `x.com` or `twitter.com`, or a subdomain of one of them. Any other URL SHALL be rejected with 400 before any network request is made. URLs with credentials, a non-default port or an IP-literal host SHALL be rejected.

#### Scenario: Unsupported host
- **WHEN** the link points to any other host, including an internal address
- **THEN** the server answers 400 and makes no request

#### Scenario: Look-alike host
- **WHEN** the link host merely contains an allowed name, such as `youtube.com.example.net`
- **THEN** the server answers 400

#### Scenario: Pasted share text
- **WHEN** the `url` field contains text around a link
- **THEN** the server answers 400; clients are responsible for extracting the link

### Requirement: Bounded download
The download SHALL fetch a single video (never a playlist), at most 30 seconds of it, at most 64 MiB, at most 1080 pixels high, and SHALL be stopped after a wall-clock limit. It SHALL run as an unprivileged user in the per-job directory with a clean environment, and SHALL NOT use cookies or credentials.

#### Scenario: Long video
- **WHEN** the source is longer than 30 seconds
- **THEN** only the first 30 seconds are downloaded and converted

#### Scenario: Too large
- **WHEN** the download would exceed 64 MiB
- **THEN** the attempt ends `failed` with `download_too_large` and nothing is published

#### Scenario: Playlist link
- **WHEN** the link points to a playlist
- **THEN** only the video the link identifies is considered, never the whole list

### Requirement: Failure reporting
When the download cannot produce a video, the attempt SHALL end `failed` with `download_failed`, or `download_unsupported` when the link has no downloadable video (private, removed, age-restricted, live or image-only). The slot's published video and image SHALL stay untouched, and the temporary files SHALL be removed.

#### Scenario: Private video
- **WHEN** the link points to a private video
- **THEN** the attempt ends `failed` with `download_unsupported` and the current media stays published

#### Scenario: Platform changed
- **WHEN** the downloader fails for any other reason
- **THEN** the attempt ends `failed` with `download_failed` and the diagnostic is logged, never returned to the client
