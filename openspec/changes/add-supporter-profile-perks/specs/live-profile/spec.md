# Spec Delta

## Purpose

Defines how a supporter can opt in to showing the game they are currently playing on their profile, and how the system limits provider calls and protects that information.

## ADDED Requirements

### Requirement: Presence endpoint
`GET /v1/profile/:id/presence` SHALL be available without a session and SHALL return `playing`, which is null or an object with `source`, `name` and `gameId`.

#### Scenario: Playing a mapped game
- **WHEN** an opted-in supporter is playing a Steam game known to GameNode
- **THEN** `playing` has `source` `steam`, the game's Steam name and its GameNode `gameId`

#### Scenario: Playing an unmapped game
- **WHEN** an opted-in supporter is playing a Steam game unknown to GameNode
- **THEN** `playing` has the game's Steam name and `gameId` null

#### Scenario: Not playing
- **WHEN** an opted-in supporter is not in a game, or their Steam game details are private
- **THEN** `playing` is null

### Requirement: Live profile is opt-in
The system SHALL report presence only for a user with supporter entitlement, `showLiveProfile` true and a connected Steam account, and SHALL return `playing` null with status 200 in every other case.

#### Scenario: Preference disabled
- **WHEN** a supporter has `showLiveProfile` false
- **THEN** `playing` is null and Steam is not contacted

#### Scenario: Not a supporter
- **WHEN** the user has no supporter entitlement
- **THEN** `playing` is null and Steam is not contacted

#### Scenario: No Steam connection
- **WHEN** an opted-in supporter has no connected Steam account
- **THEN** `playing` is null and Steam is not contacted

#### Scenario: Unknown user
- **WHEN** a client requests presence for an id that does not exist
- **THEN** the system responds 200 with `playing` null

### Requirement: Presence does not affect profile reads
Profile reads SHALL NOT contact Steam and SHALL NOT include the current game.

#### Scenario: Reading an opted-in supporter's profile
- **WHEN** a client reads `GET /v1/profile/:id` for an opted-in supporter
- **THEN** no Steam request is made

### Requirement: Presence provider call limit
The system SHALL make at most one Steam request per user in any 60-second window, regardless of the number of viewers, and SHALL make no request for a user nobody is viewing.

#### Scenario: Many viewers
- **WHEN** many clients request the same user's presence within 60 seconds
- **THEN** Steam is contacted at most once

#### Scenario: Nobody viewing
- **WHEN** no client requests a user's presence
- **THEN** no Steam request is made for that user

### Requirement: Disabling live profile applies immediately
When a supporter changes their preferences, the next presence read SHALL use the new preferences and SHALL NOT return a previously stored result.

#### Scenario: Supporter disables live profile while playing
- **WHEN** a supporter sets `showLiveProfile` to false within the 60-second window of a stored result
- **THEN** the next presence read returns `playing` null

### Requirement: Presence failure behavior
A Steam failure SHALL produce `playing` null with status 200, and the failure result SHALL count toward the provider call limit.

#### Scenario: Steam unavailable
- **WHEN** the Steam request fails or times out
- **THEN** the system responds 200 with `playing` null and does not contact Steam again for that user within 60 seconds
