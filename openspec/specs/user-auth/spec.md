# user-auth Specification

## Purpose

Governs how GameNode users sign in through social providers, how API requests resolve the signed-in user, how several provider identities link to one user, how roles, admin user management and lockouts (suspensions and bans) work, and how first-sign-in data is established.

## Requirements

### Requirement: Social provider sign-in
The system SHALL let users sign in with the `google`, `discord` and `twitter` providers under `/v1/auth`. Successful provider callbacks at `/v1/auth/callback/:provider` SHALL create a session and redirect to the requested callback URL on a trusted origin. Unknown providers SHALL be rejected.

#### Scenario: New user signs in with a supported provider
- **WHEN** a person with no GameNode account completes the `google`, `discord` or `twitter` authorization flow and the provider returns an email
- **THEN** the system creates one user and one linked provider account, creates a session, and redirects to the requested callback URL

#### Scenario: Provider returns no email
- **WHEN** a provider completes authorization without returning an email address
- **THEN** the system creates no user or session and redirects with an error

#### Scenario: Unsupported provider requested
- **WHEN** a client requests social sign-in with a provider id that is not configured
- **THEN** the system rejects the request with an error and starts no authorization flow

### Requirement: Returning sign-in by provider identity
A sign-in whose provider and provider user id are already linked SHALL sign in to the user that owns that link, even if the provider now reports a different email.

#### Scenario: Linked identity signs in again
- **WHEN** a user signs in with a provider identity already linked to their account
- **THEN** the system creates a session for that same user and creates no new user or account

### Requirement: Implicit account linking by verified email
A sign-in with a provider identity that is not linked yet SHALL link it to the existing user with the same email only when the provider reports that email as verified. Email matching SHALL be case-insensitive and each email SHALL belong to at most one user.

#### Scenario: Second provider with the same verified email
- **WHEN** a user who signed up with `google` signs in with `discord` and Discord reports the same email as verified
- **THEN** the system links the Discord identity to the existing user and creates a session for that user without creating a new user

#### Scenario: Same email reported as unverified
- **WHEN** a provider identity that is not linked reports an email that belongs to an existing user and marks it unverified
- **THEN** the system creates no user, links nothing, creates no session, and redirects with an account-not-linked error

### Requirement: Explicit account linking
An authenticated user SHALL be able to link another supported provider to their account. The linked identity's email SHALL match the user's email. A provider identity already linked to a different user SHALL be rejected.

#### Scenario: Link a provider with a matching email
- **WHEN** an authenticated user starts linking `twitter` and completes authorization with an identity whose email matches theirs
- **THEN** the system links the identity to that user

#### Scenario: Provider identity owned by another user
- **WHEN** an authenticated user tries to link a provider identity that is already linked to a different user
- **THEN** the system rejects the link and leaves both users' accounts unchanged

### Requirement: Listing and unlinking provider accounts
An authenticated user SHALL be able to list their linked provider accounts and unlink one of them. The system SHALL refuse to unlink a user's last remaining account.

#### Scenario: Unlink one of several providers
- **WHEN** a user with `google` and `discord` linked unlinks `discord`
- **THEN** the system removes the Discord link and later Discord sign-ins no longer resolve to that user through the removed link

#### Scenario: Unlink the last provider
- **WHEN** a user with exactly one linked provider tries to unlink it
- **THEN** the system rejects the request and keeps the account linked

### Requirement: Request session resolution
Protected API routes SHALL resolve the user from a session cookie or an `Authorization: Bearer` session token. Missing, expired or revoked sessions SHALL get HTTP 401. Routes marked public SHALL allow anonymous requests and still expose the user when a valid session is present.

#### Scenario: Valid bearer session token
- **WHEN** a request to a protected route carries a valid session token in the `Authorization: Bearer` header
- **THEN** the route runs with that session's user id

#### Scenario: No session on a protected route
- **WHEN** a request to a protected route has no valid session
- **THEN** the system responds with HTTP 401 and the route does not run

#### Scenario: Anonymous request on a public route
- **WHEN** a request without a session reaches a route marked public
- **THEN** the route runs with no user

### Requirement: Sign-out
Signing out SHALL revoke the current session so its cookie or bearer token is rejected afterwards.

#### Scenario: Token used after sign-out
- **WHEN** a user signs out and a later request reuses the same session token
- **THEN** the system responds with HTTP 401 on protected routes

### Requirement: User roles
Every user SHALL have at least the `user` role from creation and MAY also hold `admin`, `mod` or `editor`. Routes that require roles SHALL allow a user holding any listed role and respond HTTP 403 otherwise. Only admins SHALL be able to change roles, and only to these four values.

#### Scenario: New user receives the default role
- **WHEN** a user is created through social sign-in
- **THEN** the user holds the `user` role and no other role

#### Scenario: Missing required role
- **WHEN** a signed-in user without `editor` or `admin` calls a route that requires either role
- **THEN** the system responds with HTTP 403

#### Scenario: Client attempts to change its own role
- **WHEN** a signed-in non-admin user submits a profile update or role change that includes a role value
- **THEN** the system ignores or rejects the role value and the user's roles stay unchanged

#### Scenario: Admin assigns a role
- **WHEN** an admin sets another user's roles to `user,editor`
- **THEN** that user passes routes requiring `editor` on their next request

#### Scenario: Unknown role
- **WHEN** an admin tries to assign a role outside `user`, `admin`, `mod` and `editor`
- **THEN** the system rejects the request and the user's roles stay unchanged

### Requirement: Admin user management
Users holding `admin` SHALL be able to list and search users, set roles, ban and unban users, and list and revoke a user's sessions through the auth API. Every other role SHALL get HTTP 403 on these operations. No role SHALL be able to impersonate another user.

#### Scenario: Admin lists users
- **WHEN** an admin requests the user list
- **THEN** the system returns users with their roles and ban state

#### Scenario: Non-admin calls an admin operation
- **WHEN** a `mod`, `editor` or `user` calls any admin user-management operation
- **THEN** the system responds with HTTP 403 and changes nothing

#### Scenario: Impersonation attempt
- **WHEN** any signed-in user, admins included, requests to impersonate another user
- **THEN** the system rejects the request and creates no session for the target user

### Requirement: Suspensions and bans lock users out
A suspension SHALL lock the user out for 14 days and a ban SHALL lock them out permanently. Locking a user out SHALL revoke all their sessions immediately and reject their sign-ins while the lockout is active. An expired suspension SHALL no longer block sign-in.

#### Scenario: Moderator suspends a reported user
- **WHEN** a `mod` or `admin` handles a report with the suspend action
- **THEN** the reported user's sessions stop working at once and their sign-ins are rejected until 14 days later

#### Scenario: Suspension expires
- **WHEN** a suspended user signs in after their 14-day suspension has ended
- **THEN** the sign-in succeeds

#### Scenario: Banned user signs in
- **WHEN** a permanently banned user completes a provider sign-in
- **THEN** the system creates no session and redirects with a banned error

### Requirement: Permanent bans require admin role
Only users holding `admin` SHALL be able to issue permanent bans, whether through report handling or the admin API. The role SHALL be read from the issuer's current user record.

#### Scenario: Moderator tries to ban through a report
- **WHEN** a `mod` without `admin` handles a report with the ban action
- **THEN** the system responds with HTTP 400, bans nobody and leaves the report open

#### Scenario: Ban fails partway through report handling
- **WHEN** the lockout is applied but the rest of the report handling fails before commit
- **THEN** the report stays open, and handling it again succeeds without duplicating the lockout

### Requirement: Locked-out users produce no new activity
Background jobs SHALL NOT create community activities for a user with an active suspension or ban.

#### Scenario: Import for a suspended user
- **WHEN** an import job tries to create an activity for a user whose suspension is still active
- **THEN** no activity is created

### Requirement: Lockout state on profile listings
The admin profile listing SHALL report `isSuspended` for users with an active, expiring lockout and `isBanned` for users with a permanent lockout.

#### Scenario: Suspended and banned users listed
- **WHEN** an admin lists profiles that include one suspended and one banned user
- **THEN** the suspended user has `isSuspended: true, isBanned: false` and the banned user has `isSuspended: false, isBanned: true`

### Requirement: User data initialization on sign-in
Every successful sign-in SHALL ensure the user has a GameNode profile, library and level. Initialization SHALL be idempotent, and when it fails the sign-in SHALL fail so the next attempt can complete it.

#### Scenario: First sign-in initializes data
- **WHEN** a new user completes their first sign-in
- **THEN** the user has exactly one profile, one library and one level record, keyed by their user id

#### Scenario: Initialization previously failed
- **WHEN** a user whose profile was never created signs in again
- **THEN** the system creates the missing data and the sign-in succeeds

### Requirement: UUID user identifiers
User ids SHALL be UUID strings so they stay valid wherever the API validates user ids as UUIDs.

#### Scenario: Created user id format
- **WHEN** a user is created
- **THEN** the user id is a valid UUID

### Requirement: Auth data store
User, session, provider account and verification data SHALL live in the main GameNode MySQL database. No external auth service or SuperTokens table SHALL be required.

#### Scenario: Migrated development database
- **WHEN** all migrations have run against the development `gamenode` database
- **THEN** it contains the `user`, `session`, `account` and `verification` tables and none of the SuperTokens tables, `linked_provider` or `user_suspension`
