# Spec Delta

## Purpose

Decide who may see a user's library games and collections, through an owner-controlled setting on each game and on the profile, applied the same way on every read that exposes a user's games.

## ADDED Requirements

### Requirement: Visibility levels
The system SHALL support three visibility levels for library content: `public` (anyone, signed in or not), `followers` (the owner and users who currently follow the owner) and `private` (only the owner). Any other value SHALL be rejected with 400.

#### Scenario: Unknown level
- **WHEN** the owner submits a visibility value other than `public`, `followers` or `private`
- **THEN** the request fails with 400 and nothing is changed

### Requirement: Per-game visibility
Every library entry SHALL have a visibility level. A new entry SHALL be `public` unless the request sets another level. An update that omits the level SHALL keep the stored one.

#### Scenario: Entry created without a level
- **WHEN** the owner adds a game to the library without sending a visibility level
- **THEN** the entry is stored as `public`

#### Scenario: Update keeps the level
- **WHEN** the owner updates the status or platforms of a `private` entry without sending a visibility level
- **THEN** the entry stays `private`

#### Scenario: Entry created with a level
- **WHEN** the owner adds a game with visibility `followers`
- **THEN** the entry is stored as `followers`

### Requirement: Changing a game's visibility
The owner SHALL be able to change the visibility of one of their entries by game, without resending the rest of the entry. Only the owner of the entry SHALL be able to change it. The change SHALL apply to the next read.

#### Scenario: Owner changes the level
- **WHEN** the owner sets the visibility of a game in their library to `private`
- **THEN** the request succeeds and the next read by another user does not include that game

#### Scenario: Game not in the library
- **WHEN** a user sets the visibility of a game that is not in their library
- **THEN** the request fails with 404

#### Scenario: Signed-out request
- **WHEN** a request to change a game's visibility has no session
- **THEN** it fails with 401

### Requirement: Related entries inherit visibility
When adding a game also creates entries for its related DLCs or expansions, each newly created related entry SHALL take the visibility of the main entry. Related entries that already existed SHALL keep their own level.

#### Scenario: DLC added with a private game
- **WHEN** the owner adds a `private` game together with a DLC that was not in the library
- **THEN** the DLC entry is created as `private`

### Requirement: Imported entries
Entries created by library imports and automatic sync SHALL be created as `public`, and SHALL NOT change the visibility of entries that already exist.

#### Scenario: Re-import of a private game
- **WHEN** an import processes a game that is already in the library as `private`
- **THEN** the entry stays `private`

### Requirement: Profile library visibility
Every profile SHALL have a library visibility level, `public` by default. The owner SHALL be able to change it through the profile update. The change SHALL apply to all of their entries and collections on the next read, without changing the stored per-game levels.

#### Scenario: Owner makes the library private
- **WHEN** the owner sets the library visibility to `private`
- **THEN** other users see no games and no collections of that owner on their next read
- **AND** each entry keeps its own stored visibility level

#### Scenario: Owner makes the library public again
- **WHEN** the owner sets the library visibility back to `public`
- **THEN** each game is again visible according to its own level

### Requirement: Effective visibility of a game
A game in a library SHALL be visible to a viewer only when the viewer satisfies both the profile's library level and the entry's own level. The owner SHALL always see all of their entries. A viewer satisfies `public` always, `followers` when they are the owner or currently follow the owner, and `private` only when they are the owner.

#### Scenario: Public library, followers-only game
- **WHEN** a library is `public` and an entry is `followers`
- **THEN** a follower sees the entry and an anonymous visitor does not

#### Scenario: Followers library, public game
- **WHEN** a library is `followers` and an entry is `public`
- **THEN** a signed-in user who does not follow the owner does not see the entry

#### Scenario: Owner reads a private game
- **WHEN** the owner reads their own `private` entry in a `private` library
- **THEN** the entry is returned

#### Scenario: Viewer unfollows
- **WHEN** a follower who could see a `followers` entry stops following the owner
- **THEN** their next read does not include that entry

### Requirement: Collection membership does not affect game visibility
Whether an entry belongs to any collection, and whether those collections are public or private, SHALL NOT change the visibility of the entry.

#### Scenario: Game in no collection
- **WHEN** an anonymous visitor lists a `public` library that contains a `public` entry that is in no collection
- **THEN** the entry is returned

#### Scenario: Game only in a private collection
- **WHEN** a `public` entry belongs only to a private collection
- **THEN** other users see the entry in the library listing
- **AND** the private collection is not shown for it

### Requirement: Collection visibility
A collection SHALL be visible to a non-owner only when it is public and the viewer satisfies the profile's library level. A visible collection SHALL list only the entries the viewer may see. Hidden collections SHALL be omitted from collection lists and SHALL return 404 when requested directly.

#### Scenario: Public collection in a private library
- **WHEN** a library is `private` and a collection in it is public
- **THEN** other users do not see the collection, and requesting it directly returns 404

#### Scenario: Public collection with a private game
- **WHEN** a public collection in a `public` library contains a `private` entry
- **THEN** another user listing the collection does not see that entry

#### Scenario: Private collection
- **WHEN** another user requests a private collection
- **THEN** the response is 404 whatever the library level

### Requirement: Private collections are not disclosed on entries
Entries returned to a non-owner SHALL list only the collections that the viewer may see. The owner SHALL see all collections of their entries.

#### Scenario: Entry in a public and a private collection
- **WHEN** another user reads a visible entry that belongs to a public and a private collection
- **THEN** the entry lists only the public collection

### Requirement: Library and favorites listings
Library and favorites listings for another user SHALL contain only entries the viewer may see, with counts and pagination computed over those entries. When the viewer may not see the library at all, the listing SHALL return an empty page with status 200.

#### Scenario: Visitor lists a public library
- **WHEN** an anonymous visitor lists a `public` library with 39 `public` entries in no collection
- **THEN** the listing returns all 39 entries and a total of 39

#### Scenario: Hidden library
- **WHEN** a non-follower lists the favorites of a `followers` library
- **THEN** the response is 200 with no entries and a total of 0

#### Scenario: Filters keep the rule
- **WHEN** a visitor lists a library filtered by status
- **THEN** only visible entries with that status are returned

### Requirement: Single-entry reads
Reads of one entry, whether by entry id, by user and game, through its related DLC entries or through its owned-platform icons, SHALL return 404 to a viewer who may not see it, with the same response as for a missing entry. Related entry lists SHALL omit related entries the viewer may not see.

#### Scenario: Hidden entry by id
- **WHEN** an anonymous visitor requests a `private` entry by its id
- **THEN** the response is 404, the same as for an id that does not exist

#### Scenario: Hidden entry by game
- **WHEN** a non-follower requests another user's entry for a game whose entry is `followers`
- **THEN** the response is 404

#### Scenario: Related entries partly hidden
- **WHEN** a visitor requests the related entries of a visible game whose DLC entry is `private`
- **THEN** the DLC entry is omitted

### Requirement: Profile exposes library visibility
Profile reads SHALL include the profile's library level and whether the current viewer may see the library. Anonymous viewers SHALL be treated as non-followers.

#### Scenario: Follower reads a followers-only profile
- **WHEN** a follower reads the profile of a user whose library is `followers`
- **THEN** the response reports the library level `followers` and that the viewer may see the library

#### Scenario: Anonymous reads a private library profile
- **WHEN** an anonymous visitor reads a profile whose library is `private`
- **THEN** the response reports the library level `private` and that the viewer may not see the library

### Requirement: Entry responses expose their level
Entry responses SHALL include the entry's own visibility level.

#### Scenario: Owner reads their entry
- **WHEN** the owner reads their own entry stored as `followers`
- **THEN** the response includes the level `followers`

### Requirement: Journal follows game visibility
The journal overview, heatmap and per-game play log of another user SHALL include only games the viewer may see. A play log for a game the viewer may not see SHALL return 404.

#### Scenario: Journal of a mixed library
- **WHEN** a visitor reads the journal of a `public` library with one `public` and one `private` finished game
- **THEN** only the `public` game appears in the overview and heatmap

#### Scenario: Hidden play log
- **WHEN** a visitor requests the play log of a game whose entry is `private`
- **THEN** the response is 404

### Requirement: Playtime follows game visibility
Another user's playtime for a game SHALL be visible only when the viewer may see the library and, if the game has a library entry, may see that entry. Playtime listings and totals SHALL include only such games.

#### Scenario: Playtime of a hidden game
- **WHEN** a visitor requests a user's playtime for a game whose entry is `private`
- **THEN** no playtime is returned for that game

#### Scenario: Playtime without an entry
- **WHEN** a user has synced playtime for a game that is not in their library and the library is `public`
- **THEN** a visitor sees that playtime

#### Scenario: Hidden library
- **WHEN** a visitor lists the playtime of a user whose library is `private`
- **THEN** the listing is empty

### Requirement: Profile metrics follow game visibility
Profile statistics, distributions, period reports and period summaries of another user SHALL be computed only over the games and playtime the viewer may see, and SHALL count only collections the viewer may see. The owner's own metrics SHALL include everything.

#### Scenario: Visitor reads the overview
- **WHEN** a visitor reads the stats overview of a `public` library with 10 `public` and 2 `private` entries
- **THEN** the total number of games is 10

#### Scenario: Hidden library
- **WHEN** a non-follower reads the stats overview of a `followers` library
- **THEN** every count and total is 0

### Requirement: Year recap follows library visibility
The year recap and its status for another user SHALL return 404 when the viewer may not see the library. When the recap is visible, its list of played games SHALL omit games the viewer may not see. Recap totals and distributions computed when the recap was generated MAY still include hidden games.

#### Scenario: Recap of a private library
- **WHEN** a visitor requests the recap of a user whose library is `private`
- **THEN** the response is 404

#### Scenario: Recap with a hidden game
- **WHEN** a visitor reads the recap of a `public` library that has a `private` game among its played games
- **THEN** that game is not in the played games list

### Requirement: Library activities follow game visibility
Activities about a library entry SHALL be returned to a viewer, in any feed or listing and as a single activity, only when the viewer may see that entry. A hidden activity requested by id SHALL return 404, and likes and comments on it SHALL be rejected as inaccessible. A private collection referenced by a visible activity SHALL NOT be shown to non-owners.

#### Scenario: Feed with a hidden game
- **WHEN** an owner adds a `private` game to a public collection and a follower reads the following feed
- **THEN** the activity about that entry is not in the feed

#### Scenario: Like on a hidden activity
- **WHEN** a non-follower tries to like an activity about a `followers` entry
- **THEN** the reaction is rejected and no statistics or notification intent are created

### Requirement: Notifications follow game visibility
Notification eligibility for content about a library entry SHALL use that entry's visibility for the recipient. When an entry's visibility or the profile's library level becomes more restrictive, notifications that the recipient may no longer see SHALL stop exposing that context on the next inbox read.

#### Scenario: Entry becomes private
- **WHEN** a follower has a notification about a comment on an activity for a `followers` entry, and the owner sets the entry to `private`
- **THEN** the follower's next inbox read does not expose that context

### Requirement: Reviews are public
Reviews SHALL be visible to everyone whatever the visibility of their library entry, the profile's library level or the collections of that entry. Review listings, rankings, scores and review notifications SHALL NOT filter by entry visibility or collection privacy.

#### Scenario: Review of a private game
- **WHEN** a user reviews a game whose entry is `private`
- **THEN** the review appears in the game's review listing and rankings for anonymous visitors

#### Scenario: Review of a game only in a private collection
- **WHEN** a review belongs to an entry that is only in private collections
- **THEN** the review is still eligible for rankings and notifications

### Requirement: Existing hidden entries stay hidden
When the feature is deployed, entries that belong to at least one collection and only to private collections SHALL be stored as `private`. All other entries and all profiles SHALL start as `public`.

#### Scenario: Entry only in private collections at deploy
- **WHEN** the migration runs and an entry belongs only to private collections
- **THEN** the entry is stored as `private` and stays hidden from other users

#### Scenario: Entry in no collection at deploy
- **WHEN** the migration runs and an entry belongs to no collection
- **THEN** the entry is stored as `public` and becomes visible to other users
