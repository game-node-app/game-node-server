# Data Model: Account Deduplication

## Schema Additions
None directly required in our underlying DB if we rely heavily on SuperTokens' DB for linking (SuperTokens supports manual AccountLinking if enabled at core layer or we can rely on our `User` and `Connection` models).

If Game Node handles identities internally:
### `User` Entity
- Retains single primary identity.
- Relationships: `1:Many` with `UserProvider` (or existing platform/connection identities).

### `LinkedProvider` Entity (or existing equivalent like Connections)
- fields: `providerId` (Google, Discord, etc), `providerUserId` (The external ID), `userId` (FK to User).

When overriding SuperTokens, we may bridge the Supertokens `user.id` to our database's `User` via the external link mechanism.

