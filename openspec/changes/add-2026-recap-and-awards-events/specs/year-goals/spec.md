# Spec Delta

## Purpose

Lets users set a finished-games goal for a year from the Recap, read their progress, and get one mid-year reminder about it.

## ADDED Requirements

### Requirement: Users set a finished-games goal for a year
`PUT /v1/recap/goals/:year` SHALL require authentication and store the user's target of finished games for that year, as an integer from 1 to 999. The year SHALL be the current year or the next one. Saving again SHALL replace the target.

#### Scenario: Save 2027 goal in December 2026
- **WHEN** a user saves a target of 18 for 2027 on 20 Dec 2026
- **THEN** the goal is stored and returned with target 18

#### Scenario: Past year
- **WHEN** a user saves a goal for 2025 during 2026
- **THEN** the request is rejected with 400

#### Scenario: Invalid target
- **WHEN** a user saves a target of 0
- **THEN** the request is rejected with 400

### Requirement: Users read their goal and progress
`GET /v1/recap/goals/:year` SHALL require authentication and return the user's target for that year, or null, together with the number of games they finished in that year so far.

#### Scenario: Goal with progress
- **WHEN** a user with a 2027 target of 18 has finished 5 games in 2027
- **THEN** the response contains target 18 and finished 5

#### Scenario: No goal
- **WHEN** a user has no goal for 2027
- **THEN** the response contains a null target and their finished count

### Requirement: Mid-year goal reminder
On 1 July of a year, each user with a goal for that year SHALL receive one notification with their target and progress. A rerun on the same day SHALL NOT send it again.

#### Scenario: July reminder
- **WHEN** the reminder runs on 1 Jul 2027 for a user with target 18 and 7 finished
- **THEN** the user receives one goal reminder with target 18 and finished 7

#### Scenario: Rerun
- **WHEN** the reminder job runs twice on 1 Jul 2027
- **THEN** each user still has one goal reminder
