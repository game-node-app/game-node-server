# Spec Delta

## Purpose

Lets players practice Cover and Specs as many times as they want with random answers, without affecting daily puzzles, results, streaks or rankings.

## ADDED Requirements

### Requirement: Starting a practice round
Any visitor, signed in or not, SHALL be able to start a practice round for Cover or Specs. The response SHALL contain an unguessable round id and the initial play state for that mode, without revealing the answer. Other modes SHALL be rejected with a validation error. Starting rounds SHALL be rate limited per client.

#### Scenario: Start Cover practice
- **WHEN** a visitor starts a Cover practice round
- **THEN** they receive a round id, 6 attempts and the first pixelated image, and no answer

#### Scenario: Unsupported mode
- **WHEN** a visitor starts an Artwork practice round
- **THEN** the request is rejected with a 400 error

#### Scenario: Too many rounds
- **WHEN** a client starts more rounds than the rate limit allows within its window
- **THEN** further starts are rejected with a 429 error until the window passes

### Requirement: Playing a practice round
A practice round SHALL be played with the same attempts, feedback, hints, images and answer reveal as a daily puzzle of the same mode. Progress SHALL be stored on the round and can only grow, as with daily progress. A round started while signed in SHALL be playable only by that account; a round started as a guest SHALL be playable by anyone holding its id.

#### Scenario: Same feedback as the daily
- **WHEN** a player makes a wrong guess in a Specs practice round
- **THEN** the response has the same Specs columns as a daily Specs guess

#### Scenario: Another account
- **WHEN** a signed-in player tries to play a round started by another account
- **THEN** the request is rejected with a 403 error

#### Scenario: Rewriting progress
- **WHEN** a play removes or changes guesses already stored on the round
- **THEN** the request is rejected with a 400 error

### Requirement: Practice answers never spoil puzzles
A practice round SHALL NOT use a game that is the answer of any daily puzzle dated today or later, or of the current or a future weekly challenge, in any mode.

#### Scenario: Tomorrow's answer
- **WHEN** a game is reserved as tomorrow's Artwork answer
- **THEN** it is never chosen for a Cover or Specs practice round

### Requirement: Practice has no effect on competition
Practice rounds SHALL NOT create daily results and SHALL NOT appear in results, archive, today's puzzles, community statistics, streaks or any ranking.

#### Scenario: Winning practice
- **WHEN** a signed-in player wins a practice round
- **THEN** their results, streak and ranking points are unchanged

### Requirement: Practice rounds are temporary
Practice rounds SHALL be deleted 7 days after they start. Playing a deleted or unknown round SHALL respond 404. Deleting an account SHALL delete its rounds.

#### Scenario: Old round
- **WHEN** a player plays a round started 8 days ago
- **THEN** the request is rejected with a 404 error
