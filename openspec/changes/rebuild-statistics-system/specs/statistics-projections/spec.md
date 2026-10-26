# Spec Delta

## Purpose

Provide reliable accumulated and temporal statistics that can be rebuilt from retained facts without changing domain data or notification delivery.

## ADDED Requirements

### Requirement: Current gauges and historical counters remain distinct
Active-like counts SHALL reflect committed current engagement state. Accepted views, like additions, like removals, and like ranking credits SHALL retain their own additive meanings. Historical counters SHALL NOT be reconstructed from surviving active likes alone or changed retroactively by an ordinary unlike.

#### Scenario: Like is removed in a later month
- **WHEN** a January like is removed in February
- **THEN** January additions remain one, February removals become one, and the active-like count becomes zero

#### Scenario: Current count is read after a reaction commits
- **WHEN** the actor reads the committed reaction result before background projection runs
- **THEN** likesCount already reflects that transition

### Requirement: Repeated processing has one aggregate effect
Processing a historical event SHALL update its affected aggregates and record its completion atomically. Concurrent processing, retries, and acknowledgement loss SHALL NOT duplicate contributions or mark partial effects complete.

#### Scenario: Worker stops before aggregate commit
- **WHEN** processing stops after preparing aggregate updates but before commit
- **THEN** retry applies the event exactly once to the final aggregates

#### Scenario: Worker acknowledgement is lost
- **WHEN** aggregate effects committed but their transport acknowledgement did not
- **THEN** redelivery preserves the same totals and time buckets

### Requirement: Recovery remains durable and bounded
Committed events SHALL remain recoverable independently of queue/cache contents. Recovery SHALL use bounded work, finite automatic retries, inspectable terminal failures, and targeted rearm. A failed event SHALL NOT prevent unrelated eligible events from progressing, and no committed fact SHALL be skipped because another event with a later identifier finished first.

#### Scenario: Queue work is lost
- **WHEN** Redis loses or rejects work after an event commits
- **THEN** durable recovery still discovers that event and eventually projects it

#### Scenario: Commits finish out of identifier order
- **WHEN** a lower-identifier event commits after a higher-identifier event was processed
- **THEN** both events remain eligible for one contribution

#### Scenario: A poison event is encountered
- **WHEN** an unsupported event repeatedly fails
- **THEN** it remains diagnosable while later valid work continues and rearm does not repeat a domain action

### Requirement: Period queries use explicit boundaries and occurrence times
Temporal statistics SHALL use half-open start-inclusive/end-exclusive intervals and normalized UTC instants. Aggregation SHALL use each fact's trusted occurrence time, or its identified historical timestamp approximation. Partial aggregation buckets SHALL NOT silently include events outside the requested interval.

#### Scenario: Events fall on the interval boundaries
- **WHEN** events occur exactly at the requested start and end
- **THEN** the start event is included and the end event is excluded

#### Scenario: Request cuts through an hour
- **WHEN** the requested interval starts at 10:20 and ends at 12:10 UTC
- **THEN** events before 10:20 and at or after 12:10 are excluded rather than counting three whole hours

#### Scenario: A fact arrives late
- **WHEN** an event is recorded after its occurrence bucket was previously projected
- **THEN** processing updates its original bucket and subsequent applicable rankings

### Requirement: Summaries and series disclose freshness and coverage
Statistics summaries and series SHALL expose projection freshness and whether their requested history is complete. Empty valid sources SHALL return zero additive values. Reads SHALL NOT present queue acceptance, historical conversion time, or the latest processed event timestamp as proof of complete history.

#### Scenario: Known old history is incomplete
- **WHEN** a request includes time before the local conversion boundary
- **THEN** the response identifies incomplete historical coverage

#### Scenario: Projection is behind
- **WHEN** committed facts are still pending projection
- **THEN** the response identifies lag rather than claiming every recent fact is already reflected

### Requirement: Rebuild is deterministic and isolated
Rebuilding statistics from retained facts and current engagement state SHALL produce the same aggregates as incremental processing under the same definitions. Rebuild SHALL prevent concurrent incompatible statistics writes or projection and SHALL NOT mutate source content, emit notifications, or reset notification delivery/read state.

#### Scenario: Two rebuilds use the same input
- **WHEN** statistics is rebuilt twice with unchanged retained facts and current state
- **THEN** both results match the expected incremental totals and buckets

#### Scenario: Another writer is active
- **WHEN** a rebuild cannot establish its documented maintenance boundary
- **THEN** it refuses to reset or publish partial statistics

### Requirement: Retention preserves declared query and replay guarantees
Facts required by supported period queries, recap, view deduplication, or rebuild SHALL NOT be purged silently. The initial local implementation SHALL retain historical facts and their identities; any later retention policy SHALL declare which historical queries and rebuild guarantees it changes.

#### Scenario: Transport history expires
- **WHEN** completed queue jobs or result-cache entries expire
- **THEN** retained facts still support deduplication, supported time queries, and rebuild

### Requirement: Source and account lifecycle preserves safe statistics
Removed or inaccessible content SHALL be excluded from public statistics and rankings using current eligibility. Account cleanup SHALL remove active reactions, reconcile affected active counters, and remove actor identity from retained facts under the existing deletion policy. Such cleanup SHALL NOT fabricate user-initiated unlike history.

#### Scenario: Post is soft-deleted during projection
- **WHEN** a post is removed before a pending event is projected or a cached ranking is served
- **THEN** the public result does not expose that post or protected context

#### Scenario: Actor account is deleted
- **WHEN** account cleanup removes that actor's active reactions
- **THEN** remaining sources have correct active-like counts and retained historical facts disclose no deleted actor identity
- **AND** notification lifecycle behavior remains governed by its own contract

#### Scenario: Statistics extends an existing source invalidation
- **WHEN** source deletion or a privacy change updates statistics eligibility
- **THEN** the existing notification invalidation/redaction still participates in the owning action transaction
- **AND** statistics does not substitute its own eligibility or cleanup for the current content-access rules

### Requirement: Catalog and search retain their integration guarantees
Catalog persistence SHALL initialize statistics inside its existing game transaction, preserve counts on replay, and create no statistics backlog. Search SHALL obtain popularity from the replacement statistics model while preserving native IDs, zero defaults for sparse games, existing filters/order, and its established refresh schedule.

#### Scenario: Referenced game initialization rolls back
- **WHEN** a catalog transaction fails after initializing a referenced game's statistics
- **THEN** the reference, statistics identity, and source relationships roll back together

#### Scenario: Sparse game is indexed
- **WHEN** a game has no interactions
- **THEN** search retains the game with zero popularity and the existing game document contract

### Requirement: Recap uses actor history without depending on active likes
The likes-performed recap SHALL count retained like-addition facts by actor and interval, including likes subsequently removed. Conversion limitations SHALL be disclosed for old periods. Recomputing statistics SHALL NOT modify already persisted recap snapshots without an explicit recap operation.

#### Scenario: User unlikes before recap generation
- **WHEN** a retained like-addition event lies in the recap period but is no longer active
- **THEN** that addition remains included in the newly generated recap

### Requirement: Local conversion preserves domain state and known facts
Local conversion SHALL preserve source records and active likes, transfer available interaction facts with restart-safe identities, and report counter corrections, excluded invalid references, and unavailable history. Missing facts SHALL NOT be invented. Old workers SHALL be stopped or their work captured before obsolete storage is removed.

#### Scenario: Conversion is interrupted and repeated
- **WHEN** a conversion batch is retried
- **THEN** already converted state and facts remain singular and no notification or domain action is replayed

#### Scenario: Legacy counters disagree with retained facts
- **WHEN** available view records or active likes differ from their stored counters
- **THEN** rebuilt values follow the retained facts and current state, with the before/after correction included in the conversion report

#### Scenario: Historical unlike facts are missing
- **WHEN** removed legacy likes cannot be recovered
- **THEN** conversion records the coverage limitation without synthesizing unlike events or distributing a counter over time

#### Scenario: Notification queue inventory is already complete
- **WHEN** the previous notification cutover archived old like commands but view or initialization jobs remain
- **THEN** statistics conversion inventories those remaining jobs independently
- **AND** it preserves the notification cutover audit and does not replay archived likes or repeat notification conversion
