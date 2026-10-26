# Spec Delta

## Purpose

Deliver notifications for committed community and system actions without coupling action success to asynchronous presentation or delivery availability.

## ADDED Requirements

### Requirement: Notification intent commits with the action
The system SHALL persist the notification intent atomically with a qualifying domain state transition. A rolled-back action SHALL leave no deliverable notification. Failure to persist the intent SHALL prevent confirmation of that transition.

#### Scenario: Action and intent commit
- **WHEN** a comment is successfully persisted
- **THEN** its notification intent is durable before the action is confirmed
- **AND** notification presentation need not be available yet

#### Scenario: Intent persistence fails
- **WHEN** persisting the notification intent fails inside the action transaction
- **THEN** the action is rolled back and is not reported as completed

### Requirement: Delivery failure does not undo a committed action
After action and intent commit, notification generation or transport failures SHALL NOT undo the action or require the client to repeat it. The system SHALL retain sufficient context to retry notification delivery independently.

#### Scenario: Delivery infrastructure is unavailable
- **WHEN** notification transport is unavailable after a like or comment commits
- **THEN** the action remains successful and the notification remains recoverable

#### Scenario: Process exits before scheduling
- **WHEN** a process exits after action commit but before scheduling delivery
- **THEN** recovery discovers and processes the committed intent without repeating the action

### Requirement: Repeated delivery has one visible effect
For each logical event and recipient, the system SHALL create at most one individual notification and apply its contribution to an inbox group once. Retrying delivery SHALL NOT reset read state, inflate counts, or create another group for the same contribution.

#### Scenario: Acknowledgement is lost
- **WHEN** notification materialization commits but its acknowledgement is lost
- **THEN** processing the event again preserves the same notification, counts, and read state

#### Scenario: Concurrent consumers process one event
- **WHEN** two consumers concurrently process the same logical event
- **THEN** only one contribution becomes visible to its recipient

### Requirement: Delivery completion means successful materialization
The system SHALL distinguish committed intent, scheduled work, completed materialization, suppressed delivery, and failed delivery. Acceptance by transport SHALL NOT be treated as successful materialization.

#### Scenario: Accepted work disappears before processing
- **WHEN** transport accepted work that never materialized a notification
- **THEN** the intent remains incomplete and eligible for bounded recovery

#### Scenario: Repeated generation failure
- **WHEN** an event exhausts automatic retry attempts
- **THEN** its failure remains inspectable and supports targeted reprocessing without recreating the domain action

### Requirement: Trusted and versioned event contracts
Notification intents SHALL use supported, versioned event types with validated identities and bounded payloads. Recipients and actors SHALL derive from authenticated actions or trusted persisted system outcomes. The system SHALL NOT expose a public arbitrary-notification creation operation.

#### Scenario: Unknown payload version
- **WHEN** processing encounters an unsupported event version
- **THEN** the event is recorded as a diagnosable failure without creating a partial notification

#### Scenario: Authenticated actor identity
- **WHEN** a user performs an action that generates a notification
- **THEN** the actor is the authenticated user, independent of actor or recipient properties supplied in the request

### Requirement: Community producer semantics
Top-level comments SHALL notify the content owner; replies SHALL notify the immediate parent-comment owner. Successful follow transitions SHALL notify the followed user. These events SHALL retain their triggering identity and destination context. Self-notifications SHALL be suppressed without failing the action.

#### Scenario: Reply targets an existing thread
- **WHEN** a user replies to another user's comment
- **THEN** the notification identifies the new reply, its parent, and the content root
- **AND** the recipient is the parent-comment owner

#### Scenario: Parent belongs to another root
- **WHEN** a requested parent comment belongs to a different content root
- **THEN** comment creation is rejected and no notification intent is committed

#### Scenario: Repeated follow request
- **WHEN** a user repeats a follow request for an existing relationship
- **THEN** no additional follow event or notification is generated

#### Scenario: User acts on own content
- **WHEN** an otherwise valid action would notify its own actor
- **THEN** the action succeeds without a visible self-notification

### Requirement: Import outcomes remain independently recoverable
Import notifications SHALL describe committed discovery and automatic-import outcomes. Delivery retries SHALL NOT repeat imports, change processed or ignored choices, or suppress recovery of failed imports. Each committed discovery-result identity SHALL produce at most one notification per recipient.

#### Scenario: Mixed import results and delivery failure
- **WHEN** a discovery page commits imported, skipped, and failed outcomes but notification generation fails
- **THEN** delivery can retry with those committed counts
- **AND** successful imports are not repeated and failed imports remain eligible for their own recovery

### Requirement: Moderation alerts follow committed outcomes
Moderation notifications SHALL be generated only for committed alert, suspension, or ban outcomes and SHALL target the affected user. Discarded reports SHALL NOT notify that user. Alert payloads SHALL exclude reporter identity, internal notes, and other privileged report data.

#### Scenario: Moderation close rolls back
- **WHEN** applying and recording a moderation outcome fails before commit
- **THEN** no notification is delivered for that uncommitted outcome

#### Scenario: System alert is delivered
- **WHEN** a committed moderation outcome is materialized
- **THEN** it uses a system actor and only recipient-safe outcome information

### Requirement: Delivery operations remain bounded and observable
Recovery SHALL use bounded batches and finite automatic retries. Operations SHALL expose pending age, failures, retry state, and completion latency without secrets or unbounded user-specific metric dimensions. Expired processing ownership SHALL be recoverable without stale workers overwriting a completed result.

#### Scenario: Recovery worker stops during a batch
- **WHEN** a recovery worker stops while owning pending events
- **THEN** another worker can resume after ownership expires and completed effects remain unchanged

#### Scenario: One event repeatedly fails
- **WHEN** a malformed or permanently failing event cannot be delivered
- **THEN** later eligible events continue processing and operators can identify the failed event for targeted action
