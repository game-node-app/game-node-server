# Spec Delta

## Purpose

Defines the public wall that lists the supporters keeping GameNode online, including who appears on it and how fresh it is.

## ADDED Requirements

### Requirement: Public supporters list
`GET /v1/supporters` SHALL be available without a session and SHALL return, for each listed supporter, only the user id, username and static avatar details.

#### Scenario: Anonymous visitor
- **WHEN** a client without a session reads the wall
- **THEN** the system responds 200 with the listed supporters

#### Scenario: Listed fields
- **WHEN** a client reads the wall
- **THEN** no item contains billing data such as status, plan or subscription dates

### Requirement: Wall visibility is opt-out
Every user with supporter entitlement SHALL appear on the wall unless their `showOnSupportersWall` preference is false.

#### Scenario: Supporter with default preferences
- **WHEN** a supporter never changed their preferences
- **THEN** that supporter appears on the wall

#### Scenario: Supporter opted out
- **WHEN** a supporter has `showOnSupportersWall` false
- **THEN** that supporter does not appear on the wall

### Requirement: Wall exclusions
The wall SHALL NOT list users without supporter entitlement, nor users who are currently banned or suspended.

#### Scenario: Entitlement ended
- **WHEN** a user's supporter entitlement has ended
- **THEN** that user does not appear on the wall

#### Scenario: Canceled but still paid
- **WHEN** a canceled subscription's paid period has not ended
- **THEN** that user appears on the wall

#### Scenario: Banned supporter
- **WHEN** a supporter is banned or suspended
- **THEN** that supporter does not appear on the wall

#### Scenario: More than one hundred candidates
- **WHEN** more than 100 users hold subscriptions
- **THEN** entitlement and lockout are evaluated for all of them

#### Scenario: Billing not configured
- **WHEN** Stripe is not configured
- **THEN** the wall responds 200 with an empty list

### Requirement: Wall ordering and pagination
The wall SHALL be ordered by username ascending and paginated through `offset` and `limit`, with a default limit of 20 and a maximum of 100, returning the total number of listed supporters.

#### Scenario: Second page
- **WHEN** a client reads the wall with `offset` 20 and `limit` 20
- **THEN** the response has the next 20 supporters by username and the total

#### Scenario: Limit above maximum
- **WHEN** a client sends `limit` 101
- **THEN** the system responds 400

### Requirement: Wall freshness
The wall SHALL reflect entitlement and profile changes within 10 minutes, and a change to a supporter's preferences SHALL apply on the next read.

#### Scenario: Repeated reads
- **WHEN** clients read the wall repeatedly within the freshness window
- **THEN** the responses are served without recomputing the list

#### Scenario: Opting out
- **WHEN** a supporter sets `showOnSupportersWall` to false
- **THEN** the next wall read no longer lists that supporter
