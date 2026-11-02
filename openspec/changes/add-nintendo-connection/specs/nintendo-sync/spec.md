# Spec Delta

## Purpose

Links a user's Nintendo Account to GameNode and imports the games they played on Switch and Switch 2, with their playtime, from the account's own play history.

## ADDED Requirements

### Requirement: Nintendo account linking by pasted link
The `nintendo` provider SHALL use `delegated_code` onboarding. `auth/init` SHALL return a Nintendo Account login URL that carries the `state` and a PKCE challenge. `auth/callback` SHALL accept, in `callbackParams.code`, the account-selection link the user copied. The link's `state` SHALL equal the callback `state`. The server SHALL then exchange the link's code with the stored verifier, and link the Nintendo account ID and nickname.

#### Scenario: Valid pasted link
- **WHEN** the user submits `POST /v1/connections/nintendo/auth/callback` with a valid `state` and `callbackParams.code` set to the copied `npf5c38e31cd085304b://auth#...` link from that login
- **THEN** the server stores the connection with `sourceUserId` set to the Nintendo account ID, `sourceUsername` set to the account nickname and `authStatus: "connected"`, stores the session token encrypted, and schedules initial synchronization

#### Scenario: Pasted text is not an account-selection link
- **WHEN** `callbackParams.code` is missing, is not a link with that prefix, or has no `session_token_code` in its fragment
- **THEN** the server responds HTTP 400, creates no connection and stores no credentials

#### Scenario: Link from a different login attempt
- **WHEN** the pasted link's `state` differs from the callback `state`
- **THEN** the server responds HTTP 400 without contacting Nintendo, creates no connection and stores no credentials

#### Scenario: Link replayed after a successful connection
- **WHEN** the same pasted link and `state` are submitted again after a successful callback
- **THEN** the server rejects the request because the state was already consumed, even though Nintendo itself would accept the code again

#### Scenario: Nintendo rejects the code
- **WHEN** Nintendo rejects the code exchange, for example because the code is older than ten minutes
- **THEN** the server responds HTTP 400, creates no connection and stores no credentials

### Requirement: Nintendo session lifecycle
For each sync, the system SHALL use the stored session token to obtain an access token, reusing a stored access token that is valid for more than five minutes. If Nintendo rejects the session token as `invalid_grant`, the connection SHALL become `reauth_required` and background Nintendo syncs for it SHALL stop. Any other token failure SHALL count as a temporary sync failure.

#### Scenario: Access token expired
- **WHEN** a Nintendo sync runs and the stored access token expires within five minutes
- **THEN** the system obtains a new access token from the session token, stores it encrypted and keeps the session token unchanged

#### Scenario: Session revoked or expired
- **WHEN** Nintendo answers the token request with HTTP 400 `invalid_grant`
- **THEN** the connection's `authStatus` becomes `reauth_required` and further background Nintendo syncs for it are skipped until the user reconnects

#### Scenario: Nintendo unavailable
- **WHEN** the token request fails with a network error or HTTP 5xx
- **THEN** the sync fails as a temporary failure and the connection stays `connected`

### Requirement: Play history response validation
The system SHALL treat Nintendo's play history as untrusted input. A response without a `playHistories` array SHALL fail the sync as incomplete. So SHALL a non-empty one in which an entry lacks a 16-hex title ID, a platform code or a numeric total of minutes. No data from a failed response SHALL be imported or registered. An empty `playHistories` array SHALL be a successful empty result.

#### Scenario: Entry without a title ID
- **WHEN** play history returns entries and any of them has no 16-hex title ID
- **THEN** the sync fails as incomplete, nothing is imported, and the logged failure lists the entry's field names but no values

#### Scenario: Account without play history
- **WHEN** play history returns an empty `playHistories` array
- **THEN** discovery succeeds with no games and playtime import succeeds with no records

### Requirement: Nintendo library import
Library discovery for `nintendo` SHALL read the account's play history and keep only Switch (`HAC`) and Switch 2 (`BEE`) entries that the user has not hidden. It SHALL match title IDs through `NintendoTitleId` mappings. A matched game SHALL use the platform of its most recently played entry. Unmatched title IDs SHALL be registered as unmapped entries.

#### Scenario: Game played on both consoles
- **WHEN** play history has an `HAC` and a `BEE` entry for one mapped title ID, and the `BEE` entry was played last
- **THEN** the importer lists that catalog game once, on the Switch 2 platform

#### Scenario: Hidden title
- **WHEN** a title ID appears in the play history's hidden title list
- **THEN** it is neither listed for import nor registered as unmapped

#### Scenario: Other Nintendo systems
- **WHEN** play history contains an entry whose platform code is neither `HAC` nor `BEE`
- **THEN** that entry is skipped and the sync continues

#### Scenario: Unmapped title
- **WHEN** a Switch title ID has no mapping
- **THEN** it is not listed for import and is registered as an active unmapped entry for category `NintendoTitleId`, named with the title name Nintendo reports in English

#### Scenario: Already processed entry
- **WHEN** the user already imported or ignored a matched Nintendo game
- **THEN** it is not listed again unless processed entries are explicitly included

### Requirement: Nintendo playtime import
Playtime import for `nintendo` SHALL store, for each mapped game and platform, Nintendo's total played time with source `nswitch`, along with the first-played and last-played dates. Visible entries that map to the same game and platform SHALL be combined: minutes summed, the earliest first-played date and the latest last-played date.

#### Scenario: First playtime import
- **WHEN** play history reports 250 minutes on `HAC` for a mapped title ID, first played 2026-08-25 and last played 2026-08-29
- **THEN** a Switch playtime record of 15,000 seconds with source `nswitch`, first played date 2026-08-25 and last played date 2026-08-29 is stored for the mapped game

#### Scenario: Same title on both consoles
- **WHEN** play history reports one title ID with 100 minutes on `HAC` and 40 minutes on `BEE`
- **THEN** the mapped game has a Switch record of 6,000 seconds and a Switch 2 record of 2,400 seconds

#### Scenario: Unmapped or hidden title
- **WHEN** play history reports playtime for a title ID that has no mapping or is hidden
- **THEN** no playtime is stored for it

### Requirement: Per-user Nintendo rate-limit scope
Nintendo calls SHALL be budgeted per Nintendo account, so a throttling response for one user's calls SHALL NOT delay other users' Nintendo syncs.

#### Scenario: One user throttled
- **WHEN** Nintendo responds HTTP 429 to a call made with one user's token
- **THEN** the cooldown applies only to that Nintendo account's budget scope
