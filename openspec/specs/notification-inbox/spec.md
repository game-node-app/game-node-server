# Notification Inbox Specification

## Purpose

Provide a fast, recipient-owned notification inbox whose items contain the safe summaries and navigation context required for immediate frontend rendering.

## Requirements

### Requirement: Inbox items are ready to render
Each visible inbox item SHALL include a stable identity, supported notification type, bounded public actor summaries, safe preview, resolved typed destination, event time, event and actor counts, and current/read versions. Rendering the list SHALL NOT require fetching the source graph or full domain entities per item.

#### Scenario: Page contains multiple content types
- **WHEN** a recipient loads a page containing review, activity, post, follow, importer, and moderation notifications
- **THEN** the response contains enough safe presentation and destination data to render every item without per-item API requests

### Requirement: Trigger and destination are distinct
Notifications SHALL distinguish the action's triggering record, the subject that received the action, and the navigation root. Comment notifications SHALL retain the triggering comment and parent identities when available. Destinations SHALL use supported internal target types and identifiers, not arbitrary client-provided URLs.

#### Scenario: Reply to a review comment
- **WHEN** a reply notification is returned
- **THEN** its destination identifies the review root and the specific reply to focus
- **AND** the client does not need to traverse the parent comment to discover the root

### Requirement: Aggregation precedes pagination
Likes, top-level comments, and replies SHALL be grouped by recipient, action kind, subject, and UTC calendar day. Follow, importer, and moderation events SHALL remain individual items. Groups SHALL persist independently of page boundaries, and counts SHALL distinguish events from distinct actors.

#### Scenario: One subject has more events than the page size
- **WHEN** 30 likes on one subject occur in one grouping day and a page size of 20 is requested
- **THEN** those contributions occupy one inbox item with 30 events
- **AND** subsequent pages do not contain another item for that same group

#### Scenario: Same actor contributes several comments
- **WHEN** one actor creates three comments belonging to one group
- **THEN** the group reports three events and one distinct actor

#### Scenario: A new grouping day begins
- **WHEN** another event for the same subject occurs on the next UTC calendar day
- **THEN** it belongs to a separate group

### Requirement: Cursor pagination has explicit live-list semantics
The inbox SHALL paginate groups by descending latest event time and a unique tie-breaker, with a validated recipient-scoped cursor and a page limit from 1 to 100, defaulting to 20. Responses SHALL expose next-cursor and continuation state without requiring a full-history total. Updated groups SHALL retain their identities; visibility filtering SHALL not cause unbounded scans.

#### Scenario: Events share a timestamp
- **WHEN** several groups have the same latest event time
- **THEN** ordering and page continuation use the unique tie-breaker deterministically

#### Scenario: Group moves during navigation
- **WHEN** a group receives a new event while the client is reading older pages
- **THEN** refreshing the first page exposes that group's latest version under the same identity
- **AND** the contract does not claim snapshot-consistent traversal of a changing inbox

#### Scenario: Cursor or page limit is invalid
- **WHEN** a request has a malformed cursor, another recipient's cursor, or a limit outside the accepted integer range
- **THEN** the request is rejected without executing an unbounded query

#### Scenario: Visibility filtering reaches its scan bound
- **WHEN** filtering inaccessible candidates exhausts the bounded scan budget before filling a page
- **THEN** the response can contain fewer items and a cursor advancing beyond the scanned candidates
- **AND** continuation indicates remaining candidates, not a guaranteed full visible next page

### Requirement: Inbox reads do not consume notifications
Listing notifications SHALL NOT change read state or advance a shared discovery marker. Durable unread state SHALL survive cache eviction, restarts, and inactive periods. The list response SHALL expose the recipient's visible unread-group count.

#### Scenario: User returns after an inactive period
- **WHEN** the recipient returns after more than five minutes without polling
- **THEN** unread notifications remain available regardless of cache state

#### Scenario: Two devices list the same inbox
- **WHEN** two authenticated devices list one recipient's inbox
- **THEN** neither request consumes notifications or hides them from the other device

### Requirement: Read acknowledgements cover only observed versions
A recipient SHALL acknowledge an item through an observed version. Read acknowledgements SHALL be monotonic and idempotent, scoped to the session owner, and bounded to 100 items per request. Acknowledging an older version SHALL NOT mark a newer event as read; versions beyond the item's current version SHALL be rejected.

#### Scenario: New event races with acknowledgement
- **WHEN** version 4 arrives while the recipient acknowledges version 3
- **THEN** the item remains unread at version 4

#### Scenario: Another user acknowledges an item
- **WHEN** a session attempts to acknowledge an inbox item owned by another recipient
- **THEN** the operation is rejected and that item's read state is unchanged

#### Scenario: Acknowledgement is retried
- **WHEN** an already-applied acknowledgement is repeated
- **THEN** read state and unread counts remain unchanged

### Requirement: Projections preserve current access and deletion rules
The inbox SHALL NOT expose excerpts, identities, destinations, or counts that violate current access rules. Removing content or making it inaccessible SHALL prevent its snapshots from remaining visible, including during delayed generation or invalidation. Preview redaction SHALL preserve unrelated safe notification state where possible.

#### Scenario: Post is soft-deleted
- **WHEN** a post has been soft-deleted before its notification is read or materialized
- **THEN** its content preview and active destination are not exposed

#### Scenario: Collection becomes private
- **WHEN** source context becomes inaccessible to a recipient
- **THEN** the inbox suppresses the protected context before subsequent reads expose it

#### Scenario: Latest triggering comment is deleted
- **WHEN** a group contains other valid events but its latest comment is deleted
- **THEN** that comment's excerpt and focus target are removed or replaced with safe available context
- **AND** unrelated contributions and read acknowledgements are not blindly reset

### Requirement: Previews expose only recipient-safe content
Previews SHALL be bounded plain text and safe media metadata, without raw user HTML, private profile/account fields, or privileged moderation data. Missing or removed actors SHALL not require serializing their full former profiles.

#### Scenario: Comment contains HTML
- **WHEN** a notification preview is created from an HTML comment
- **THEN** its preview is plain text with bounded length and no executable markup

### Requirement: Replace the legacy contract directly
The new inbox contract SHALL be the only supported notification API. The old discovery marker endpoint, boolean viewed-update endpoint, offset aggregation contract, and source-ID hydration payload SHALL be removed. Existing application URI versioning SHALL not require a parallel compatibility API.

#### Scenario: Client uses the replacement API
- **WHEN** a client lists the notification endpoint after cutover
- **THEN** it receives materialized inbox items and cursor pagination
- **AND** no legacy response adapter or dual-write path is involved

#### Scenario: Client calls a retired operation
- **WHEN** a client calls the former new-notification or boolean viewed-update operation
- **THEN** that legacy operation is unavailable and is not silently emulated

### Requirement: Existing state migrates without replaying actions
Schema replacement SHALL preserve representable historical notification and read state through a bounded, restart-safe one-time conversion. Missing trigger context SHALL not be invented. Migration SHALL preserve domain data and pending committed delivery while avoiding historical action replay or newly announced old notifications.

#### Scenario: Legacy comment notification lacks the triggering comment ID
- **WHEN** that notification is converted
- **THEN** its available root context is retained with a safe generic preview and no fabricated focus ID

#### Scenario: Historical group has mixed read states
- **WHEN** read and unread legacy records are converted into one group
- **THEN** the group remains unread and previously acknowledged contributions are not re-announced as new events

#### Scenario: Conversion restarts
- **WHEN** a conversion batch is repeated after interruption
- **THEN** existing converted contributions are not duplicated and source-domain actions are not rerun

### Requirement: Read performance is validated with representative data
Inbox reads SHALL use bounded pages and batch context checks rather than per-item source traversal. Validation SHALL measure database work, payload size, read latency, and commit-to-visible latency against representative mixed and high-volume inboxes, reporting observed results rather than unmeasured percentage gains.

#### Scenario: Page size increases within its limit
- **WHEN** equivalent pages of 20 and 100 mixed items are loaded
- **THEN** source/profile query counts are bounded by supported categories rather than by the number of items
- **AND** no full source content or collection of all group members is loaded for presentation
