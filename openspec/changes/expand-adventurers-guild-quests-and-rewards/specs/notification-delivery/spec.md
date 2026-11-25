# Spec Delta

## ADDED Requirements

### Requirement: Guild community bounty ready notifications
The system SHALL emit a system notification (`guild.community-bounty-ready`, version 1) with no actor when a published Community Bounty reaches 100% of `targetTotal`, addressed at most once per `(bountyId, recipientUserId)` to each eligible contributor. It SHALL materialize as an individual inbox item targeting `{ type: "guild", bountyId }`.

#### Scenario: Eligible contributors are notified when a Community Bounty reaches 100%
- **WHEN** the final qualifying contribution pushes `"spooky-october-2026"` to `100%` (`currentTotal >= targetTotal`)
- **THEN** one `guild.community-bounty-ready` notification intent is committed per eligible contributor targeting `{ type: "guild", bountyId }`
- **AND** duplicate evaluations or later overkill contributions do not send duplicate notifications
