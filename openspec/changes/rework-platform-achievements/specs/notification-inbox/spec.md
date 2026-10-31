# Spec Delta

## MODIFIED Requirements

### Requirement: Aggregation precedes pagination
Likes, top-level comments, and replies SHALL be grouped by recipient, action kind, subject, and UTC calendar day. Follow, importer, moderation, and achievement unlock events SHALL remain individual items. Groups SHALL persist independently of page boundaries, and counts SHALL distinguish events from distinct actors.

#### Scenario: One subject has more events than the page size
- **WHEN** 30 likes on one subject occur in one grouping day and a page size of 20 is requested
- **THEN** those contributions occupy one inbox item with 30 events
- **AND** subsequent pages do not contain another item for that same group

#### Scenario: Same actor contributes several comments
- **WHEN** one actor creates three comments belonging to one group
- **THEN** the group reports three events and one distinct actor

#### Scenario: A new grouping day begins
- **WHEN** another event for the same subject occurs on the next UTC calendar day
- **THEN** it belongs to a separate group

#### Scenario: Achievement unlocks stay individual
- **WHEN** a user unlocks two different achievements on the same day
- **THEN** the inbox shows two individual items, each with the achievement destination and the obtained tier
