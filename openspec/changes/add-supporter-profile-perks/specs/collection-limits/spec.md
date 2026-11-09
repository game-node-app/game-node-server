# Spec Delta

## Purpose

Defines how many collections a user can create on each plan and what happens to users who already hold more than the free limit.

## ADDED Requirements

### Requirement: Collection creation limit
`POST /v1/collections` SHALL reject a new collection when a user without supporter entitlement already owns 5 or more collections. Users with supporter entitlement SHALL have no limit.

#### Scenario: Free user below the limit
- **WHEN** a user without entitlement who owns 4 collections creates a collection
- **THEN** the collection is created

#### Scenario: Free user at the limit
- **WHEN** a user without entitlement who owns 5 collections creates a collection
- **THEN** the system responds 403 and creates nothing

#### Scenario: Supporter above the free limit
- **WHEN** a supporter who owns 5 collections creates a collection
- **THEN** the collection is created

#### Scenario: Supporter with many collections
- **WHEN** a supporter who owns 500 collections creates a collection
- **THEN** the collection is created

### Requirement: Limit error contract
A rejection caused by the limit SHALL carry the code `collection_limit_reached` and the limit that applied, so clients can distinguish it from other 403 responses.

#### Scenario: Limit reached
- **WHEN** a user without entitlement at the limit creates a collection
- **THEN** the response body has `code` `collection_limit_reached` and `limit` 5

### Requirement: Existing collections are preserved
The limit SHALL apply only to creation. A user above the limit SHALL keep reading, editing, deleting and adding games to every collection they own, and SHALL be able to create again once below it.

#### Scenario: Existing user above the limit
- **WHEN** a user without entitlement already owns 30 collections
- **THEN** none are removed or hidden and all remain editable

#### Scenario: Entitlement ends above the free limit
- **WHEN** a supporter who owns 50 collections loses entitlement
- **THEN** all 50 remain usable and creating another responds 403

#### Scenario: Back under the limit
- **WHEN** a user without entitlement deletes collections until owning 4 and creates one
- **THEN** the collection is created

### Requirement: Limit holds under concurrency
Concurrent creation requests from the same user SHALL NOT exceed the free limit.

#### Scenario: Parallel requests at the boundary
- **WHEN** a user without entitlement who owns 4 collections sends two creation requests at once
- **THEN** exactly one collection is created and the other request responds 403

### Requirement: Entitlement failure during creation
When entitlement decides the outcome and cannot be determined, the system SHALL fail the request without creating a collection.

#### Scenario: Lookup fails at the free limit
- **WHEN** a user who owns 5 collections creates one and the entitlement lookup throws
- **THEN** the system responds with a server error and creates nothing

#### Scenario: Lookup not needed below the free limit
- **WHEN** a user who owns fewer than 5 collections creates one
- **THEN** the collection is created without an entitlement lookup
