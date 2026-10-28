# Content Reactions Specification

## Purpose

Apply authenticated like state transitions consistently and generate trusted notification intent only for persisted, valid content interactions.

## Requirements

### Requirement: Reaction identity is server-controlled
Like and unlike requests SHALL derive the actor from the authenticated session and the notification recipient from persisted content ownership. Client-supplied actor, recipient, notification category, or navigation properties SHALL NOT influence delivery. Unknown reaction request properties SHALL be rejected.

#### Scenario: Request attempts to redirect a like notification
- **WHEN** a request supplies a recipient different from the persisted content owner
- **THEN** the unsupported recipient property is rejected and no redirected notification is created

#### Scenario: Request uses only a valid target
- **WHEN** an authenticated user likes another user's accessible review
- **THEN** the review owner is selected as the notification recipient without being supplied by the client

### Requirement: Reaction targets are validated
The system SHALL validate supported source types, type-appropriate identifiers, target existence, and applicable visibility and suspension rules before changing a reaction. Invalid or inaccessible targets SHALL NOT leave orphan statistics, reactions, counters, or notification intent.

#### Scenario: Source identity has the wrong format
- **WHEN** a request supplies a malformed UUID for a review or a non-positive game identifier
- **THEN** the request is rejected before persistence

#### Scenario: Source was removed
- **WHEN** a user attempts to like deleted or inaccessible content
- **THEN** the operation fails without creating statistics or notification intent for that target

### Requirement: Reaction confirmation means committed state
Like and unlike operations SHALL confirm their resulting state only after local persistence commits. Queue acceptance SHALL NOT constitute confirmation of a like. Notification generation SHALL remain asynchronous after committed intent.

#### Scenario: Notification transport is unavailable
- **WHEN** a valid like commits while notification transport is unavailable
- **THEN** the request succeeds with the committed like state and delivery remains pending

#### Scenario: Local reaction transaction fails
- **WHEN** local reaction or counter persistence fails
- **THEN** the request does not report a successfully persisted like

### Requirement: Reaction counter and intent are atomic
A real like transition SHALL persist the user reaction, update its counter, and record notification intent atomically. A real unlike transition SHALL remove the reaction and adjust the counter atomically. Counters SHALL change only when the corresponding row changes and SHALL never become negative.

#### Scenario: Counter update fails after reaction insertion
- **WHEN** counter persistence fails after inserting a like within the transaction
- **THEN** both the reaction and its notification intent are rolled back
- **AND** retry can complete the entire transition

#### Scenario: Concurrent unlike requests
- **WHEN** multiple unlike requests target one existing user reaction
- **THEN** exactly one removal decrements the counter and the counter remains non-negative

### Requirement: Requested reaction state is idempotent
Repeated requests for the current state SHALL leave that state unchanged without additional counter changes or notification intent. Concurrent requests for the same actor and target SHALL serialize consistently and preserve one reaction row.

#### Scenario: Like is requested twice
- **WHEN** a user repeats a successful like request
- **THEN** the content has one like from that user, one counter increment, and one event for that transition

#### Scenario: Distinct users like concurrently
- **WHEN** two users successfully like the same content concurrently
- **THEN** both reactions are represented and the counter increases by two

### Requirement: Notification events represent historical transitions
An unlike SHALL NOT retract an already delivered historical like notification. A later real like after an unlike SHALL use a new transition identity. Replaying one transition SHALL never count as another event. Likes on games without a human owner and self-likes SHALL not generate recipient notifications.

#### Scenario: Like is removed and recreated
- **WHEN** a user likes, unlikes, and subsequently likes the same content
- **THEN** the new like is a distinct transition and current counters reflect one active reaction
- **AND** notification event counts remain distinct from active-like counts and unique-actor counts

#### Scenario: Game like has no human recipient
- **WHEN** a user likes a valid game
- **THEN** the reaction and counter can update without creating an arbitrary recipient notification

### Requirement: Reaction abuse controls protect the write boundary
Authenticated reaction commands SHALL be subject to the service's existing request-throttling policy and suspension rules. The new reaction path SHALL NOT leave an alternate queued or legacy endpoint that bypasses these checks.

#### Scenario: Retired queued-like operation is called
- **WHEN** a client calls a removed queued-like operation after cutover
- **THEN** the operation is unavailable and cannot schedule a reaction through an obsolete path

#### Scenario: Suspended user attempts a reaction
- **WHEN** a suspended or banned account attempts a new like
- **THEN** the operation is rejected without a new reaction or notification intent
