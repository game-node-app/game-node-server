# Spec Delta

## Purpose

Allow authenticated clients to check ownership and load collection entries for a batch of games in one request instead of issuing per-game lookups.

## ADDED Requirements

### Requirement: Authenticated users can look up own library entries in batch
`POST /v1/collections-entries/own` SHALL require authentication and accept `{ gameIds }` (1 to 200 positive integers). It SHALL return HTTP 200 with the caller's matching `CollectionEntry` records, omitting unowned games and returning `[]` when none match. Anonymous requests SHALL receive HTTP 401 and invalid or oversized arrays HTTP 400.

#### Scenario: Release strip checks ownership for 90 games in one request
- **WHEN** an authenticated user posts 90 `gameIds` to `POST /v1/collections-entries/own` and owns 7 of them
- **THEN** the endpoint returns HTTP 200 with the 7 matching `CollectionEntry` objects belonging solely to the authenticated user

#### Scenario: User owns none of the requested games
- **WHEN** an authenticated user posts valid `gameIds` none of which exist in their library
- **THEN** the endpoint returns HTTP 200 with `[]`

#### Scenario: Unauthenticated or invalid batch request is rejected
- **WHEN** an anonymous caller calls `POST /v1/collections-entries/own` or an authenticated caller sends an empty array or more than 200 game IDs
- **THEN** the endpoint responds with HTTP 401 or HTTP 400 respectively
