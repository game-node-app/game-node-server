# Proposal

## Why

The external Python IGDB producer fetches 500 expanded games at a time and continues after a fixed delay, regardless of whether NestJS has processed the previous page. Moving orchestration into this project with strict backpressure will prevent catalog-sized Redis backlogs and support weekly catalog refreshes with conservative memory and concurrency limits.

## What Changes

- Fetch IGDB catalog pages inside NestJS, reusing the existing Twitch authentication service and game persistence logic; retire the external producer during cutover.
- Process only one bounded page at a time, defaulting to 25 games, one concurrent game, and at most two concurrent relationship operations. Fetch the next page only after all required writes for the current page succeed and its checkpoint is durable.
- Keep expanded game payloads out of BullMQ. Queue only compact orchestration identifiers, with one active run across replicas and bounded retained job history.
- Add durable, non-expiring run progress, ordered ID pagination, safe restart recovery, transient retries, and an explicit paused state for persistent failures.
- Schedule full catalog refreshes weekly by default, with a configurable 14-day interval; avoid overlapping runs and preserve periodic relationship reconciliation.
- Make replay repair incomplete game relationships and initialize imported-game statistics without creating a growing secondary queue.
- **BREAKING**: When internal sync is enabled, the legacy `POST /v1/sync/igdb` push endpoint rejects payload ingestion. Cutover requires stopping the Python producer and draining legacy jobs first; rollback keeps the legacy mode available.
- Add a reproducible local MySQL/Redis test harness, generated IGDB fixtures, boundedness assertions, and diagnostic memory reports. Document queue Redis `noeviction`, bounded logging, and operational recovery; verification requires no rented server, remote access, or live IGDB credentials.

## Capabilities

### New Capabilities

- `igdb-catalog-sync`: In-process catalog fetching, bounded batch completion, durable recovery, scheduling, single-run ownership, safe persistence, and operational visibility.

### Modified Capabilities

None. This project currently has no published OpenSpec capability specifications.

## Impact

- `src/sync/igdb/`: orchestration, fetch requests, queue handling, scheduling, configuration, and legacy endpoint mode gate.
- `src/game/game-repository/create/` and normalization utilities: bounded relationship work, lower allocation overhead, validation, and replay-safe persistence.
- Imported-game statistics initialization, plus a TypeORM migration for durable run state.
- Local-only integration/resource checks and configuration/recovery documentation. Existing deployment Compose files are outside the implementation scope; a dedicated disposable test Compose file supplies MySQL and Redis without requiring the complete application stack.
- No new external service is required. Incremental-only imports, webhook ingestion, automatic catalog deletion, and unrelated queue rewrites are outside this change.
