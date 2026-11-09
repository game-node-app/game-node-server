# Spec Delta

## Purpose

Defines how a profile exposes its owner's supporter status and how supporters store the preferences that clients use to render supporter perks.

## ADDED Requirements

### Requirement: Supporter status on profile reads
`GET /v1/profile` and `GET /v1/profile/:id` SHALL return `isSupporter`, using the existing supporter entitlement rule, and `supporterPreferences`, which holds the owner's preferences while `isSupporter` is true and is `null` otherwise.

#### Scenario: Supporter profile
- **WHEN** any client reads the profile of a user with supporter entitlement
- **THEN** the response has `isSupporter` true and `supporterPreferences` with every preference field

#### Scenario: Non-supporter profile
- **WHEN** any client reads the profile of a user without supporter entitlement
- **THEN** the response has `isSupporter` false and `supporterPreferences` null

#### Scenario: Entitlement lookup fails
- **WHEN** the entitlement lookup throws during a profile read
- **THEN** the read succeeds with `isSupporter` false and `supporterPreferences` null

### Requirement: Profile read cost for non-supporters
A public profile read SHALL determine entitlement once per request and SHALL NOT read video or preference data when the owner is not a supporter.

#### Scenario: Public read of a non-supporter
- **WHEN** a client reads `GET /v1/profile/:id` for a user without entitlement
- **THEN** the system reads only the profile and the entitlement

#### Scenario: Public read of a supporter
- **WHEN** a client reads `GET /v1/profile/:id` for a supporter with published videos
- **THEN** entitlement is determined once and the published videos and preferences are returned

#### Scenario: Owner read of a non-supporter
- **WHEN** a user without entitlement reads `GET /v1/profile`
- **THEN** the response still reports that user's video upload status

### Requirement: Preference defaults
A supporter who never changed a preference SHALL have the badge, animated avatar border, supporter theme and wall visibility enabled, no title key, no accent color and live profile disabled.

#### Scenario: New supporter
- **WHEN** a client reads the profile of a supporter with no stored preferences
- **THEN** `showBadge`, `showAnimatedAvatarBorder`, `showSupporterTheme` and `showOnSupportersWall` are true, `showLiveProfile` is false, and `titleKey` and `accentColor` are null

### Requirement: Updating preferences
A supporter SHALL be able to change any subset of preferences through `PATCH /v1/profile/supporter-preferences`, which SHALL return the complete resulting preferences and leave omitted fields unchanged.

#### Scenario: Partial update
- **WHEN** a supporter sends only `showBadge` false
- **THEN** the response has `showBadge` false and every other field unchanged

#### Scenario: Clearing a nullable preference
- **WHEN** a supporter sends `accentColor` null
- **THEN** the stored accent color is removed

#### Scenario: Non-supporter update
- **WHEN** an authenticated user without entitlement sends an update
- **THEN** the system responds 403 and stores nothing

#### Scenario: Anonymous update
- **WHEN** an unauthenticated client sends an update
- **THEN** the system responds 401 and stores nothing

### Requirement: Preference validation
The system SHALL accept an `accentColor` only as `#RRGGBB` hexadecimal or null, a `titleKey` only as 1 to 32 characters of lowercase letters, digits, `_` or `-`, or null, and boolean values for all other preferences.

#### Scenario: Invalid accent color
- **WHEN** a supporter sends `accentColor` `red`
- **THEN** the system responds 400 and stores nothing

#### Scenario: Free text in title key
- **WHEN** a supporter sends `titleKey` `GameNode Admin`
- **THEN** the system responds 400 and stores nothing

#### Scenario: Valid values
- **WHEN** a supporter sends `accentColor` `#FF8800` and `titleKey` `founder`
- **THEN** the system stores and returns both values

### Requirement: Preferences are rendering choices
The server SHALL store and return preferences without interpreting them, and a hidden badge SHALL NOT remove `isSupporter` from profile reads.

#### Scenario: Badge hidden
- **WHEN** a client reads the profile of a supporter whose `showBadge` is false
- **THEN** the response has `isSupporter` true and `showBadge` false

### Requirement: Preference lifecycle
The system SHALL keep stored preferences when entitlement ends, SHALL return them again when it resumes, and SHALL remove them when the account is deleted.

#### Scenario: Entitlement ends
- **WHEN** a supporter with stored preferences loses entitlement
- **THEN** profile reads return `supporterPreferences` null and the stored values remain

#### Scenario: Entitlement resumes
- **WHEN** that user regains entitlement
- **THEN** profile reads return the previously stored preferences

#### Scenario: Account deletion
- **WHEN** an account with stored preferences is deleted
- **THEN** its preferences are removed
