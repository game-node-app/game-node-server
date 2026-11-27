# Spec Delta

## Purpose

Enable batch public profile lookups and hydrate review responses with author summary profiles so client feeds and home cards avoid per-card profile requests.

## ADDED Requirements

### Requirement: Public profiles are readable in batch
`POST /v1/profile/all` SHALL be publicly accessible and accept `{ userIds }` (1 to 100 user ID strings). It SHALL return public `ProfileResponseDto` records matching `GET /v1/profile/:id` semantics without owner-only `videoUploads`, deduplicating inputs, omitting missing IDs without 404, and rejecting invalid or oversized arrays with HTTP 400.

#### Scenario: Home cards fetch multiple profiles in one request
- **WHEN** a caller posts `{ userIds: ["u1", "u2", "missing"] }` to `POST /v1/profile/all`
- **THEN** the response returns HTTP 200 with public profile objects for `u1` and `u2` (including `avatar`, `banner`, `isSupporter`, `supporterPreferences`, `avatarVideo`, `bannerVideo`, `libraryVisibility`, and viewer-scoped `canViewLibrary`) and omits `"missing"`

#### Scenario: Viewer library access is evaluated per profile in the batch
- **WHEN** a signed-in user requests profiles whose libraries are set to `public`, `followers`, and `private`
- **THEN** `canViewLibrary` reflects the viewer's follow relationship and ownership for each profile in the batch identically to `GET /v1/profile/:id`

#### Scenario: Invalid or oversized batch is rejected
- **WHEN** a caller submits an empty `userIds` array or more than 100 user IDs
- **THEN** `POST /v1/profile/all` rejects the request with HTTP 400

### Requirement: Review read responses embed author summary profile
Review read endpoints (`GET /v1/reviews/profile/:userId`, `GET /v1/reviews/game/:id`, `POST /v1/reviews/all`, `GET /v1/reviews`, `GET /v1/reviews/:id`) SHALL include the review author's `profile` relation with its `avatar` as an additive field alongside existing review fields.

#### Scenario: Review list embeds author profile and avatar
- **WHEN** a client lists reviews for a profile or game
- **THEN** each review includes `profile` with the author's public identity fields and `avatar` (or `null` when unset) without requiring a separate `GET /v1/profile/:id` call
