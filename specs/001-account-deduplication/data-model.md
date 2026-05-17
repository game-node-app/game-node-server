# Data Model: Account Deduplication

## Schema Additions
Use existing `LinkedProvider` to persist provider links for deduplication; do not rely on any Supertokens AccountLinking features.

### `User` Entity
- Retains single primary identity.
- Relationships: `1:Many` with `LinkedProvider`.

### `LinkedProvider` Entity
- fields: `providerId` (Google, Discord, etc), `providerUserId` (The external ID), `userId` (FK to User).

Bridge the Supertokens `user.id` to our database `User` via `LinkedProvider` during login overrides.
