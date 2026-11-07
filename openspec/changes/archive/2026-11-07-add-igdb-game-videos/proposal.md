# Proposal

## Why

The IGDB catalog import preserves screenshots and artworks but omits game videos, leaving the local catalog without trailers and their source metadata. Importing video references through the existing pipeline closes this gap without downloading or hosting media files.

## What Changes

- Add a `GameVideo` entity and `game_video` table, associated with `Game.videos`, preserving the IGDB record ID, game association, name, external `video_id` and checksum.
- Include expanded `videos` metadata in the existing IGDB game query, normalize it into the project's camelCase representation, and persist it through the existing transactional one-to-many importer.
- Store a YouTube watch URL derived from `video_id` when present. IGDB supplies the external identifier rather than a video URL; the identifier remains stored unchanged.
- Make videos available through existing game queries with `relations.videos` and the existing resource lookup, following other game resources.
- Preserve checksum handling, periodic reconciliation, transaction rollback, replay safety and concurrency limits. Existing games gain videos when their relationships are next reconciled.
- Out of scope: downloading, uploading, transcoding, generating thumbnails, checking YouTube availability, playback UI, a new endpoint, a separate video sync worker, automatic deletion of missing videos, or an immediate full-catalog backfill.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `igdb-catalog-sync`: include metadata-only game video ingestion, persistence and retrieval alongside existing media relationships.

## Impact

- **Persistence:** one additive MySQL migration for `game_video`, with source ID as primary key and an indexed game foreign key; no changes to existing game/image rows. Rollback removes imported video metadata only.
- **Catalog/import code:** `igdb-catalog.fields.ts`, `utils/game-conversor-utils.ts`, `entities/game.entity.ts`, a new `entities/game-video.entity.ts`, `game-repository.module.ts`, and the create service and resource-to-entity map. `IGDBPartialGame` already derives relationships from `Game`.
- **Callers/API:** catalog runner and import service keep their existing contract; repository single-game, multiple-game and resource queries expose the new relation/resource through existing routes. Update OpenAPI output if affected by the model change.
- **Verification:** extend the expanded-game fixture, field/normalization and importer tests, isolated MySQL import/recovery coverage, and entity registration in existing test harnesses where required. Document schema deployment and reconciliation timing in `docs/igdb-catalog-sync.md`.
- **Dependencies/configuration:** none added; reuse IGDB credentials, the current catalog request and existing processing settings.

Source contract: [IGDB Game](https://api-docs.igdb.com/#game) (`videos`) and [IGDB Game Video](https://api-docs.igdb.com/#game-video) (`game_videos`).
