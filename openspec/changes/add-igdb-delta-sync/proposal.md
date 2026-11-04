# Proposal

## Why

New and changed IGDB games reach GameNode only through a full expanded scan every 7 days. This scan took 808 minutes in production. Games that were not yet visible in the API when the scan passed their IDs stay missing until the next run. Example: IGDB 426568 "Cadê o Flávio?" was created on 2026-10-29. The 2026-10-30 scan (upper bound 426909) did not import it, and it became visible on 2026-11-03. Ten other games in the same ID window were missed the same way. Backloggd already lists them.

Character information is not imported today. Adding it to the same delta and sweep paths lets GameNode store character details and their game associations without a separate import process.

## What Changes

- Add a **delta poller** that runs every few minutes. It reads IGDB changes by `updated_at` window for games and characters, for game-owned children that have their own `updated_at` (involved companies, external games, localizations) and for shared entities (companies, platforms, genres, themes, keywords, franchises, engines, modes, perspectives, character genders and species). It applies them through the corresponding import path, and its progress is durable for each stream.
- Import **characters** with their aliases, description, country, source metadata, mug shot, current gender/species references and many-to-many game associations. Characters are fetched independently from `/characters`; game payloads do not contain them. Existing game reads can request the character relation.
- Replace the weekly expanded full scan with a light **checksum sweep**. The sweep pages `id,checksum` for every IGDB endpoint we store and refreshes rows that are missing or whose checksum differs; character pages also include `games` to repair missing associations. This covers timestamp-less changes, including mug shots. The ordinary weekly sweep imports historical characters; there is no separate backfill job, command, state or historical delta window. **BREAKING** for operators: the run no longer fetches every game expanded.
- Declare delta streams and sweep endpoints in **one registry**. Besides the checksum, the sweep compares each endpoint's declared source fields (initially character `games` links), so a field GameNode starts storing later is filled on existing rows by the ordinary sweep.
- Add a **source-recency guard**: store IGDB's `updated_at` separately on each game and character and reject older source data for that entity.
- Refreshes started by a delta or the sweep always reconcile relationships, still diffed by checksum, even when the game's own checksum is unchanged. This replaces the periodic epoch-bucket reconciliation and removes `IGDB_SYNC_RECONCILE_EVERY_RUNS` and `IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH`.
- Out of scope: IGDB webhooks, separate backfills, propagating deletes, and removing child rows or character-game links that IGDB has dropped (unchanged existing retention policy).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `igdb-catalog-sync`: adds delta polling, character imports and game associations, the checksum sweep, the source-recency guard and always-on relationship reconciliation for refreshes. Changes the scheduled full scan into a checksum sweep. Removes epoch-bucket periodic reconciliation.

## Impact

- Code: `src/sync/igdb/catalog/*` (client queries, runner page work, state, scheduler, character persistence), new delta poller state and service, `GameRepositoryCreateService.createOrUpdate` (recency guard, relationship policy), `IgdbCatalogImportService` (ownership-agnostic transactions), game repository entities and module registration for character relations.
- Data: new nullable `game.igdbUpdatedAt` column; new durable delta-progress table; new sweep-endpoint column on `igdb_catalog_state`; character, mug-shot, gender, species and character-game join tables, including the character's own source timestamp. Each needs a migration.
- IGDB load: the previously measured endpoints account for about 6.4k sweep requests (about 3.2M rows); character endpoints add traffic that has not been measured. All delta, sweep and expanded refresh requests use the existing shared 4 req/s outbound budget.
- Config/docs: `docs/igdb-catalog-sync.md`, the removed env knobs, and test fixtures in `test/igdb/**`.
