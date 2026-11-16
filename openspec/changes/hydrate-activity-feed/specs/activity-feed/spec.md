# Spec Delta

## Purpose

Lists and reads user activities (collection additions, reviews, posts, follows, game achievements, platform achievements) so that a client can render each activity card from a single response, without one extra request per activity.

## ADDED Requirements

### Requirement: Activity responses embed the author profile
Every activity returned by the activity list, feed and detail endpoints SHALL include its author's public profile, with the avatar, alongside the existing `profileUserId`.

#### Scenario: Feed page includes authors
- **WHEN** a client requests a page of the general activity feed
- **THEN** each returned activity has `profile` set to its author's profile, including `avatar` when the author has one

### Requirement: Activity responses embed their source entity
Every returned activity SHALL include the populated source relation that matches its type: `collectionEntry` and `collection` for collection activities, `review` for reviews, `post` for posts, `userFollow` for follows, `obtainedGameAchievementActivity` with `externalGame` for game achievements, and `obtainedAchievement` with its `definition` for platform achievements. Relations that do not apply to the type SHALL be null.

#### Scenario: Review activity
- **WHEN** an activity of type `REVIEW` is returned
- **THEN** its `review` contains the review, including `gameId` and `rating`
- **AND** `post`, `collectionEntry` and `obtainedGameAchievementActivity` are null

#### Scenario: Platform achievement activity
- **WHEN** an activity of type `ACHIEVEMENT_UNLOCKED` is returned
- **THEN** its `obtainedAchievement` contains `tier` and a `definition` with the achievement's `name` and `icon`

#### Scenario: Game achievement activity
- **WHEN** an activity of type `OBTAINED_GAME_ACHIEVEMENT` is returned
- **THEN** its `obtainedGameAchievementActivity` contains `totalObtained`, the completion and platinum flags, and `externalGame.gameId`
- **AND** the per-achievement details are not required to be embedded

### Requirement: Activity responses embed the target game
An activity whose source points to a game (collection entry, review, post or game achievement) SHALL include `game` with the game's `id`, `name` and `cover`. Activities without a target game SHALL have `game` set to null.

#### Scenario: Collection activity resolves its game
- **WHEN** a `COLLECTION_ENTRY` activity is returned
- **THEN** `game.id` equals the collection entry's `gameId` and `game.cover` is present when the game has a cover

#### Scenario: Follow activity has no game
- **WHEN** a `FOLLOW` activity is returned
- **THEN** `game` is null

### Requirement: Activity responses embed engagement summary
Every returned activity SHALL include `statistics` with `likesCount` and `isLiked`. `isLiked` SHALL reflect the requesting user and SHALL be false for anonymous requests. Reading these values SHALL NOT create statistics records or engagement events.

#### Scenario: Authenticated viewer liked an activity
- **WHEN** a logged-in user who liked an activity requests a page that contains it
- **THEN** that activity's `statistics.isLiked` is true and `likesCount` equals the activity's current like total

#### Scenario: Anonymous viewer
- **WHEN** an anonymous client requests a page of activities
- **THEN** every activity's `statistics.isLiked` is false

#### Scenario: Activity without statistics identity
- **WHEN** a returned activity has no statistics target yet
- **THEN** its `statistics` is `likesCount` 0 and `isLiked` false
- **AND** no statistics target is created by the read

### Requirement: Embedded data loads in bounded queries
Building any page of activities SHALL use a number of database queries that does not depend on the page size: each kind of embedded data is loaded once for the whole page.

#### Scenario: Page size does not change query count
- **WHEN** the same endpoint is called with `limit` 5 and with `limit` 50
- **THEN** both requests run the same number of database queries

### Requirement: Activity responses stay backward compatible
The embedded fields SHALL be additive. Existing fields, endpoint paths, query parameters, ordering, filtering and pagination semantics SHALL NOT change.

#### Scenario: Existing client ignores new fields
- **WHEN** a client that reads only `id`, `type`, `profileUserId` and the source id fields calls any activity endpoint
- **THEN** those fields have the same values and the same order as before this change

### Requirement: Per-user activity lists are index-backed
Listing a user's activities, and the following feed over a set of users, SHALL be served by an index that covers filtering by author and ordering by creation time, so the database does not sort the author's full activity history per request.

#### Scenario: Profile activity list query plan
- **WHEN** the query for a single user's latest activities is explained
- **THEN** it uses the `(profileUserId, createdAt)` index on `activity` and does not report a filesort
