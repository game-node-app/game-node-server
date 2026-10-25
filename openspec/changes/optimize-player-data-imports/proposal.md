# Proposal

## Why

Player-data imports repeatedly scan inactive libraries and schedule achievement work without change detection, while queue retention, pagination, partial-response handling, and retry consistency can block subsequent imports or leave incomplete results. Establish a reliable daily baseline and reduce work per cycle before offering higher synchronization frequency to paying users.

## What Changes

- Fix effective BullMQ retention settings, recurring-job admission, Xbox batch progress, PSN pagination, and normal empty-import handling; remove the hard-coded achievement job scheduled at service construction.
- Replace the four daily full playtime scans and restart-relative importer interval with durable daily eligibility per connection, shared admission for automatic/manual entry points, bounded scheduling batches, and distributed execution times.
- Preserve immediate first synchronization for a new provider account; retain eligibility and failure state across restarts, and prevent stale jobs from writing after account replacement or disconnection.
- Select achievement work using initial-sync state, activity/change signals, failed or incomplete work, and periodic reconciliation. Persist successful empty results and deduplicate pending work.
- Reuse provider snapshots and batch local reads; atomically persist related local achievement results, completion state, and activity records, with recoverable delivery to existing activity queues.
- Add missing manual-playtime DTO validation for positive integer game/platform IDs, a supported source, non-negative integer seconds within the database range, and optional/null valid played dates; retain session ownership.
- Correct playtime checksum aging, period baselines, recent-time expiration, and observation persistence. Stop deriving session counts from polling frequency while preserving authoritative provider counts and existing historical values.
- Preserve prior data on incomplete provider responses, use unambiguous PSN mapping identities, and make auto-import retries recoverable without duplicate entries or notifications. Reject capped Xbox TitleHub library responses as incomplete until a supported continuation contract is verified; do not invent pagination or claim truncated data is complete.
- Retain the installed `psn-api` library. PSN request cancellation and HTTP status/header/Retry-After guarantees unavailable through that library are out of scope; preserve exposed errors and complete-snapshot validation.
- Add focused regression coverage, bounded operational diagnostics, migration/rollout instructions, and measured before/after resource counts.
- **Behavior changes:** automatic full synchronization defaults to once per 24 hours; manual requests respect cooldowns; achievement reads use persisted results and controlled refresh admission rather than unrestricted live provider calls. Existing response shapes remain compatible where possible, with additive freshness/status information only where required.
- Premium billing, subscriptions, premium cadence activation, new providers, and a general synchronization framework are out of scope. The admission boundary must allow a later cadence policy without implementing payment logic now.

## Capabilities

### New Capabilities

- `player-data-sync`: Durable scheduling, admission, connection identity, queue lifecycle, refresh status, and resource observability.
- `provider-library-fetching`: Complete, bounded Steam/PSN/Xbox snapshots, safe pagination, timeouts, and error classification.
- `game-achievement-import`: Selective and reconciled achievement synchronization with complete mappings, idempotent persistence, and recoverable activities.
- `playtime-history`: Consistent cumulative observations, estimated period accounting, stable counters, and efficient recent-time calculation.
- `library-auto-import`: Daily discovery, normal empty outcomes, and recoverable collection/status/notification processing.

### Modified Capabilities

None. The current OpenSpec capability inventory is empty; these specs document existing behavior together with the proposed guarantees.

## Impact

- Scheduling/admission: `src/playtime/watch`, `src/importer/importer-watch`, `src/connection`, and `src/connection/connection-sync`.
- Provider clients: `src/sync/steam`, `src/sync/psn`, `src/sync/xbox`, and existing cache utilities only where directly required.
- Persistence and consumers: `src/playtime`, `src/game/game-achievement`, `src/game/external-game`, `src/journal`, collection-entry services, and existing activity/notification queues.
- TypeORM entities, registration, migrations, applicable DTOs/OpenAPI output, focused unit/integration fixtures, and a player-import operations document.
- Existing MySQL, Redis, BullMQ, Nest scheduling, and transaction facilities are sufficient; no new dependency is proposed.
- Existing IGDB/search changes are separate work and must remain untouched except for unavoidable module-registration integration. No destructive history cleanup or automatic reconstruction of missing historical sessions is included.
