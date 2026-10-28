# Spec Delta

## Purpose

Record trusted engagement on supported content while keeping current user state distinct from durable historical facts and notification delivery.

## ADDED Requirements

### Requirement: Statistics address real sources through native identities
Statistics operations SHALL accept a supported source type and its native identifier, validate source existence and access, and preserve numeric game IDs and UUID content IDs. Invalid or inaccessible sources SHALL leave no statistics state or events. Internal statistics identifiers SHALL NOT replace public source identities.

#### Scenario: UUID content receives a view
- **WHEN** a valid post UUID is submitted for a permitted view
- **THEN** the view belongs to that exact post without integer coercion

#### Scenario: Source is invalid or inaccessible
- **WHEN** an operation references a missing game, malformed source ID, deleted post, or inaccessible activity
- **THEN** it fails without creating an orphan target, state, event, counter, or notification

### Requirement: Source creation initializes statistics atomically
Creating a supported source SHALL establish its statistics identity in the same local transaction. Repeating source initialization SHALL preserve existing interactions and counts. Catalog initialization SHALL remain bounded by the existing import transaction and SHALL NOT create per-game statistics jobs or engagement events.

#### Scenario: Catalog game is replayed
- **WHEN** an imported game or minimal referenced game is initialized again
- **THEN** it retains one statistics identity and its existing counts
- **AND** initialization emits no popularity credit or notification

#### Scenario: Source creation fails
- **WHEN** source persistence or statistics initialization fails before commit
- **THEN** neither a partial source nor its statistics identity is committed

### Requirement: Current user engagement is independently queryable
The system SHALL retain current like state and whether an authenticated user has viewed each source, independently of historical aggregation. Anonymous status SHALL return false for both flags. Repeated views SHALL NOT create duplicate user-state records.

#### Scenario: User unlikes previously viewed content
- **WHEN** a user removes their like from content they have viewed
- **THEN** their status is isLiked false and isViewed true
- **AND** the historical like and unlike facts remain recorded

#### Scenario: Anonymous status is requested
- **WHEN** status is requested without an authenticated user
- **THEN** no other user's engagement state is disclosed and both flags are false

### Requirement: Reaction analytics preserve the notification transaction
A real reaction transition SHALL commit current state, the active-like counter, its analytics event, and any qualifying notification intent in one local transaction. Duplicate state requests SHALL add none of those effects. Existing trusted ownership, authorization, idempotence, and non-negative-counter guarantees SHALL remain effective.

#### Scenario: Analytics persistence fails during a like
- **WHEN** analytics event persistence fails inside a reaction transaction
- **THEN** the entire transaction rolls back and retry can perform one real transition

#### Scenario: Notification transport is down
- **WHEN** a valid reaction and its intents commit while asynchronous transport is unavailable
- **THEN** the reaction succeeds with committed isLiked and likesCount
- **AND** notification delivery and analytics projection recover independently

#### Scenario: Several requests repeat the same like
- **WHEN** concurrent requests request the same existing like state
- **THEN** one active reaction, one counter increment, one analytics transition, and at most one qualifying notification intent exist

#### Scenario: Reaction writer extends the existing intent contract
- **WHEN** a qualifying new like is persisted using the replacement engagement storage
- **THEN** analytics and the existing version-1 notification intent use the same active action transaction and correlated immutable identity
- **AND** the notification retains its trusted native subject/root identities and valid numeric causal like identifier

#### Scenario: Notification intent validation rejects the action
- **WHEN** a reaction attempts an unsupported notification payload or an intent append outside its action transaction
- **THEN** no reaction, counter, or analytics fact is committed through that attempt

### Requirement: Like history and ranking credit have explicit semantics
Each real like and unlike SHALL remain a distinct historical fact. Only the first known like by an actor on a target SHALL earn like ranking credit; unlike and later relike SHALL NOT grant another credit. Active counts SHALL reflect current state independently of historical counts and credit.

#### Scenario: Like unlike and relike occur
- **WHEN** a user likes, unlikes, and likes the same target again
- **THEN** historical additions equal two, removals equal one, active likes equal one, and ranking credit equals one
- **AND** notifications retain the distinct real-transition semantics of content-reactions

#### Scenario: Several actors like one target
- **WHEN** two users first like the same source
- **THEN** both active reactions and both ranking credits are represented

### Requirement: View confirmation means durable recording
A valid view SHALL be confirmed only after its historical fact and any authenticated-user view state commit. Each request SHALL include a validated view identity reused for transport retries. Repeating the same identity and binding SHALL have one counting effect; reusing it for another binding SHALL be rejected without disclosing the existing event.

#### Scenario: View acknowledgement is lost
- **WHEN** a committed view request is retried with its original identity and source
- **THEN** the original accepted result is returned without another event or counter contribution

#### Scenario: A distinct navigation is viewed
- **WHEN** a new valid view identity is submitted for the same source
- **THEN** it represents another accepted impression and does not claim another unique visitor

#### Scenario: Local view persistence fails
- **WHEN** recording the view fails
- **THEN** the operation does not confirm acceptance or leave partial user state

### Requirement: Interaction identity and event time are trusted
Authenticated actors SHALL derive from the session. Event kind, occurrence time, metric values, source ownership, and notification routing SHALL derive from server-controlled actions. Public requests SHALL NOT select those facts.

#### Scenario: Client forges event details
- **WHEN** a view or reaction request supplies an actor, recipient, timestamp, weight, or unsupported property
- **THEN** validation rejects it before changing state

### Requirement: Capture enforces existing abuse and access controls
Reaction and view operations SHALL enforce applicable authentication, suspension, visibility, and existing request-throttling rules. Views SHALL be described as accepted impressions, without a promise of exact unique visitors or fraud-proof traffic attribution.

#### Scenario: Retired queued mutation is called
- **WHEN** a client calls a removed queued like or view operation after cutover
- **THEN** it cannot mutate engagement through that obsolete path

#### Scenario: Suspended actor or invalid anonymous request is submitted
- **WHEN** the caller violates the applicable account or request-validation policy
- **THEN** no new state or event is recorded

### Requirement: Analytics cannot replay notification delivery
Analytics projection and targeted retry SHALL NOT execute a domain mutation, append notification intent, change notification read state, or depend on notification retention or delivery status. Correlated reaction facts SHALL preserve the original transition identity without sharing completion state.

#### Scenario: Analytics fact is retried
- **WHEN** a committed reaction fact is projected again after a retry
- **THEN** analytics converges to the same values and notification events, groups, versions, and read state are unchanged

#### Scenario: Game or self-like is recorded
- **WHEN** a valid game like or self-like has no qualifying recipient notification
- **THEN** its statistics are recorded under the ordinary reaction rules without inventing a recipient

#### Scenario: Notification retry is independent from analytics retry
- **WHEN** a notification retry and an analytics retry occur for the same committed reaction
- **THEN** its original notification identity and payload remain valid without looking up the former active-like row
- **AND** analytics retry does not re-key it or add another inbox contribution
