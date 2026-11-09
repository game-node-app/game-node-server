# Spec Delta

## Purpose

Lets players choose which IGDB cover represents a game for them, and defines where and to whom that choice is shown.

## ADDED Requirements

### Requirement: Cover option listing
The system SHALL expose, without requiring authentication, the alternative covers available for a game. Each option SHALL identify its kind (`localized`, `edition`, `alternative` or `historical`), a display label when one exists, and an IGDB image reference. Options SHALL NOT repeat the game's own default cover.

#### Scenario: Game with localized and alternative covers
- **WHEN** a client requests the options of a game that has a Japanese localized cover and an alternative cover
- **THEN** both are returned with their kinds, and the localized option is labeled with its region

#### Scenario: Base game with editions
- **WHEN** a client requests the options of a game that has editions with covers
- **THEN** each edition's cover is returned as an `edition` option labeled with the edition title

#### Scenario: Edition page
- **WHEN** a client requests the options of an edition
- **THEN** the options of its base game, the base game's cover and the covers of its sibling editions are included, and its own default cover is not

#### Scenario: Game without alternatives
- **WHEN** a client requests the options of an existing game with no alternative covers
- **THEN** an empty list is returned

#### Scenario: Unknown game
- **WHEN** a client requests the options of a game that does not exist
- **THEN** the system responds with 404

### Requirement: Cover choice
A signed-in user SHALL be able to choose one cover option per game, replacing any previous choice for that game. The feature SHALL NOT require a supporter subscription or a library entry for the game.

#### Scenario: Choose an eligible option
- **WHEN** a signed-in user chooses an option listed for a game
- **THEN** the choice is stored and replaces any previous choice for that game

#### Scenario: Option not eligible for the game
- **WHEN** a signed-in user chooses an option that is not listed for that game
- **THEN** the system responds with 400 and any previous choice is unchanged

#### Scenario: Unknown game or option
- **WHEN** a signed-in user chooses a cover for a game or option that does not exist
- **THEN** the system responds with 404

#### Scenario: Anonymous request
- **WHEN** a request to choose or remove a cover has no valid session
- **THEN** the system responds with 401

#### Scenario: Game outside the library
- **WHEN** a signed-in user chooses a cover for a game that is not in their library
- **THEN** the choice is stored

### Requirement: Own cover choice management
A signed-in user SHALL be able to read their current choice for a game and remove it, returning to the default cover. Removing a choice that does not exist SHALL succeed without effect.

#### Scenario: Read an existing choice
- **WHEN** a signed-in user reads their choice for a game they customized
- **THEN** the system returns the chosen option's identifier

#### Scenario: Read with no choice
- **WHEN** a signed-in user reads their choice for a game they did not customize
- **THEN** the system returns an empty choice and does not respond with an error

#### Scenario: Remove a choice
- **WHEN** a signed-in user removes their choice for a game
- **THEN** that user's effective cover for the game returns to the default

### Requirement: Cover choice independence from library entries
A cover choice SHALL be independent of library entries: changing it SHALL NOT alter any library entry, and removing a game from the library SHALL NOT remove the choice. Deleting the user account SHALL remove the user's choices.

#### Scenario: Choice does not touch the entry
- **WHEN** a user changes the cover of a game in their library
- **THEN** the entry's update timestamp is unchanged and the entry does not appear as modified in period queries

#### Scenario: Game removed and added again
- **WHEN** a user removes a customized game from their library and later adds it again
- **THEN** the earlier choice still applies

#### Scenario: Account deleted
- **WHEN** a user account is deleted
- **THEN** its cover choices are removed

### Requirement: Custom cover display mode
Each profile SHALL have a custom cover display mode of `any`, `prefer_yours` or `none`, defaulting to `any`. Users SHALL be able to read and update their own mode through the profile endpoints.

#### Scenario: Default mode
- **WHEN** a profile has never changed the setting
- **THEN** its mode is `any`

#### Scenario: Update mode
- **WHEN** a signed-in user updates their profile with a valid mode
- **THEN** the mode is stored and other profile fields are unchanged

#### Scenario: Invalid mode
- **WHEN** a profile update carries a value outside the three modes
- **THEN** the system responds with 400 and nothing is changed

### Requirement: Opt-in cover personalization on game reads
Game repository reads by ID SHALL personalize covers only when the caller opts in by sending a personalization flag or a cover owner. Reads that do not opt in, or that do not request the cover relation, SHALL return the same data as before this feature and SHALL NOT resolve a session or cover choice.

#### Scenario: Caller does not opt in
- **WHEN** a client reads games without a personalization flag or cover owner
- **THEN** every game has its default cover

#### Scenario: Cover relation not requested
- **WHEN** a client opts in but does not request the cover relation
- **THEN** no cover is added and no cover choice is read

#### Scenario: Cover owner alone opts in
- **WHEN** a client sends a cover owner without the personalization flag
- **THEN** the read is personalized

### Requirement: Effective cover resolution
For a personalized read, the effective cover SHALL be resolved from the viewer's display mode, the viewer's choice and the cover owner's choice, falling back to the default cover. An anonymous viewer SHALL be treated as mode `any` with no choice of their own.

#### Scenario: Mode any on another user's content
- **WHEN** a viewer in mode `any` reads a game with a cover owner who is another user with a choice for it
- **THEN** the owner's chosen cover is returned, even if the viewer has their own choice

#### Scenario: Mode any with no owner
- **WHEN** a viewer in mode `any` reads a game with no cover owner and has a choice for it
- **THEN** the viewer's chosen cover is returned

#### Scenario: Mode prefer_yours
- **WHEN** a viewer in mode `prefer_yours` reads a game with a cover owner, and the viewer has a choice for it
- **THEN** the viewer's chosen cover is returned

#### Scenario: Mode prefer_yours without own choice
- **WHEN** a viewer in mode `prefer_yours` has no choice for a game and its cover owner has one
- **THEN** the owner's chosen cover is returned

#### Scenario: Mode none
- **WHEN** a viewer in mode `none` reads any game, including one they customized
- **THEN** the default cover is returned

#### Scenario: Anonymous viewer on owner content
- **WHEN** an anonymous viewer reads a game with a cover owner who has a choice for it
- **THEN** the owner's chosen cover is returned

#### Scenario: No applicable choice
- **WHEN** neither the viewer nor the cover owner has an applicable choice for a game
- **THEN** the default cover is returned

#### Scenario: Unknown cover owner
- **WHEN** the cover owner does not match any user
- **THEN** the read succeeds and the owner contributes no choice

### Requirement: Personalized response isolation
A personalized cover SHALL appear in the existing `cover` field with the same shape as a default cover. Personalizing one response SHALL NOT change the data returned to any other caller, including through shared caches.

#### Scenario: Same shape
- **WHEN** a read returns a chosen cover
- **THEN** the `cover` field has the same fields as a default cover and its image URL can be resized the same way

#### Scenario: Shared cache is not altered
- **WHEN** a personalized read for one user is followed by a non-personalized read of the same game
- **THEN** the second read returns the default cover

#### Scenario: Choice change is immediate
- **WHEN** a user changes their choice and reads the game again
- **THEN** the new choice is returned without waiting for any shared game cache to expire

### Requirement: Custom cover library filter
Library, favorites and collection entry listings SHALL accept a filter that restricts results to games for which the library owner has a cover choice. The filter SHALL NOT widen the visibility rules of those listings.

#### Scenario: Filter own library
- **WHEN** a user lists their library with the custom cover filter enabled
- **THEN** only entries for games they customized are returned

#### Scenario: Owner without choices
- **WHEN** the filter is enabled for a library whose owner has no cover choices
- **THEN** an empty page is returned

#### Scenario: Private entries stay hidden
- **WHEN** another viewer lists a library with the filter enabled
- **THEN** entries that are only in private collections are not returned
