# Spec Delta

## Purpose

Records every library status transition with server time so the platform knows when a game was first finished, independently of client-supplied dates or later status changes, and uses it for Guild contracts and global level XP.

## ADDED Requirements

### Requirement: Server-recorded library status history
Every creation of a library entry and every change of its `status` SHALL append one history record with the previous status (or none), the new status, the server timestamp, and the origin of the change (`manual` for user-initiated library edits including MCP tools, `import` for library imports, `related` for statuses propagated to related entries, `backfill` for migrated data). Re-saving an entry without changing its status SHALL NOT append a record.

#### Scenario: Status toggle appends history
- **WHEN** a user marks a game `finished`, later moves it to `planned`, and marks it `finished` again
- **THEN** three history records exist for that user and game with server timestamps, in order

#### Scenario: Deleting and re-adding an entry keeps history
- **WHEN** a user deletes a finished library entry and adds the same game again as `finished`
- **THEN** the original finished record is still present and remains the game's first finish

### Requirement: History durability and privacy
History records SHALL be written atomically with the entry change, SHALL never be modified or removed by application code, SHALL survive deletion of the library entry, and SHALL be removed only with the owning user's library. The history is internal and SHALL NOT be exposed by any endpoint.

#### Scenario: Failed entry save leaves no history
- **WHEN** a library entry save fails and its transaction rolls back
- **THEN** no history record for that change exists

### Requirement: First finish semantics and backfill
A game's first finish for a user SHALL be the earliest history record with status `finished`, regardless of origin. When the history is introduced, every entry currently `finished` SHALL receive a `backfill` record dated by its existing finish date (or last update when absent).

#### Scenario: Previously finished games are known after migration
- **WHEN** the history migration runs for a user who has 40 finished games
- **THEN** each of those games has a `backfill` finished record and none of them can count as a new first finish

### Requirement: Global game-finished XP only on first finish
The global level XP for finishing a game SHALL be granted only when the transition being recorded is that game's first finish for the user.

#### Scenario: Toggling a finished game does not grant XP again
- **WHEN** a user moves an already finished game to `planned` and back to `finished`
- **THEN** no additional game-finished level XP is granted

### Requirement: Status dates preserved on re-save
Saving a library entry whose resulting status equals its stored status SHALL keep the stored status dates (`plannedAt`, `startedAt`, `droppedAt`, `finishedAt`), except that an explicitly supplied `finishedAt` updates `finishedAt`.

#### Scenario: Editing platforms keeps the planned date
- **WHEN** a user edits the platforms of a game planned since 2023 without changing its status
- **THEN** its `plannedAt` stays in 2023
