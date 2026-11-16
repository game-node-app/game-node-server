# Spec Delta

## ADDED Requirements

### Requirement: Awards milestone notifications
The system SHALL produce system notifications, with no actor, for Awards milestones: nominations open, nominations close tomorrow, voting open, voting closes in two days, and results published. Each SHALL resolve to an `awards` destination naming the Awards event, its year and the phase it leads to.

#### Scenario: Voting opens
- **WHEN** the 2026 Awards voting phase starts
- **THEN** recipients receive a notification whose destination is the 2026 Awards event in phase `voting`

### Requirement: Recap and goal notifications
The system SHALL produce system notifications, with no actor, when a user's Recap becomes available, when it is finalized, and for the yearly goal reminder. Recap notifications SHALL resolve to a `recap` destination naming the recipient and year. Goal reminders SHALL resolve to a `goal` destination naming the year.

#### Scenario: Recap available
- **WHEN** a recipient's 2026 Recap notification is rendered in the inbox
- **THEN** its destination identifies the recipient's 2026 Recap without needing extra requests

#### Scenario: Goal reminder
- **WHEN** a goal reminder for 2027 is rendered in the inbox
- **THEN** its destination identifies the recipient's 2027 goal

### Requirement: Awards milestone recipients
Phase-start Awards milestones SHALL target every user who is not banned or suspended. The nominations reminder SHALL target only those users with no nomination in the event. The voting reminder SHALL target only those users whose ballot is incomplete.

#### Scenario: Complete ballot skips reminder
- **WHEN** the voting-closes reminder runs and a user has voted in every category
- **THEN** that user receives no reminder

#### Scenario: Banned user
- **WHEN** a milestone is fanned out
- **THEN** banned and suspended users receive nothing

### Requirement: Fan-out to many users is batched, resumable and deduplicated
A notification sent to many recipients SHALL append intents in bounded batches, SHALL resume after interruption from where it stopped, and SHALL produce at most one notification per recipient, even when triggered again.

#### Scenario: Interrupted fan-out
- **WHEN** a fan-out is interrupted after 3 of 10 batches and the next tick runs
- **THEN** it continues from batch 4 and recipients of batches 1–3 are not notified again

#### Scenario: Late milestone
- **WHEN** the scheduler was down when voting opened and recovers 5 hours later during voting
- **THEN** the voting-open milestone is fanned out once

#### Scenario: Stale milestone
- **WHEN** the scheduler recovers after the voting phase already ended
- **THEN** the voting-open and voting reminder milestones are not sent
