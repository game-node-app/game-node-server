# Proposal

## Why

Notification responses expose references that the frontend must resolve through multiple APIs, while grouping after pagination, expiring discovery state, and non-transactional publication produce inconsistent results. Replace this pre-launch system with a fast, self-contained inbox and recoverable asynchronous delivery, and close the client-controlled like-recipient vulnerability.

## What Changes

- Materialize notification summaries and typed navigation targets before reads, including the triggering comment, root content, game context, and bounded actor previews.
- Persist notification intent with each domain action in a MySQL transactional outbox; reuse BullMQ for a shared recurring relay schedule and asynchronous projection with recovery, bounded retries, and database-enforced deduplication.
- Store individual event deliveries separately from inbox groups; aggregate before pagination and persist version-aware read state per recipient.
- **BREAKING** Replace the existing notification contract in place. Remove the legacy `/notifications/new`, boolean `/notifications/view`, source-ID arrays, and offset-based aggregation. There is one supported contract, with no v1 adapter, parallel v2 API, dual-write rollout, or frontend implementation in this change.
- **BREAKING** Replace queued like commands with authenticated, idempotent local transactions that derive the recipient from persisted content and atomically update the reaction, counter, and outbox. Remove the client-selected like recipient and obsolete like-job path; retain asynchronous views and statistics initialization.
- Migrate comment, follow, importer, and moderation producers to typed internal events; preserve importer recovery guarantees while removing its redundant delivery mechanism.
- Replace notification entities, relations, DTOs, exports, and queue payloads where useful. Use explicit schema/data migrations and one-time bounded conversion of existing notification state, rather than retaining runtime compatibility. Preserve domain data and do not replay historical actions.
- Enforce recipient authorization, safe previews, deletion/privacy handling, bounded queries, and the BullMQ Redis `noeviction` policy; document measured read and delivery performance.

## Capabilities

### New Capabilities

- `notification-delivery`: Transactional intent, typed producers, recoverable asynchronous materialization, deduplication, and operational recovery.
- `notification-inbox`: Ready-to-render items, typed destinations, persisted grouping, cursor pagination, recipient-owned read state, visibility, and direct contract replacement.
- `content-reactions`: Trusted like ownership, synchronous idempotent state transitions, consistent counters, and notification intent for real transitions.

### Modified Capabilities

None. The durable capability inventory is empty. The related `library-auto-import` delta in `optimize-player-data-imports` retains its guarantees; its notification-delivery implementation and documentation must converge on this change.

## Impact

- `src/notifications`, `src/statistics` and its queue, `src/comment`, `src/follow`, `src/report`, `src/importer/importer-watch`, and source deletion/privacy paths in posts, reviews, activities, collections, and profiles.
- TypeORM registrations and migrations, API DTOs/OpenAPI, notification and importer unit/integration fixtures, `docker-compose.prod.yml`, and operations documentation.
- Existing NestJS, MySQL, Redis, BullMQ, scheduling, and transaction facilities suffice. No new broker, database, microservice, general event framework, or dependency is planned.
- Out of scope: frontend edits, email/push/WebSocket delivery, new mention or broadcast features, preferences, billing, and unrelated statistics or import redesigns. The unpublished site does not require compatibility with the old API.
