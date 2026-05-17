# Feature Specification: Account Deduplication

**Feature Branch**: `001-account-deduplication`

**Created**: 2026-05-17

**Status**: Draft

**Input**: User description: "Implement account deduplication in this project. If a user logs in with multiple providers (e.g. email, google, discord) and they have the same email address, they should log in to the same account."


## Clarifications

### Session 2026-05-17
- Q: How should the system handle the migration/retention of these existing duplicate accounts? → A: Prompt the user to merge accounts upon their next login (requires user confirmation).
- Q: If a provider's underlying email changes and suddenly conflicts with another primary account, how should the system resolve the collision during login? → A: Deny the login attempt, automatically unlink the provider from the previous account, and require the user to verify/link it to the new account manually.
- Q: Can we use Supertokens AccountLinking recipe or imports for linking? → A: No, never use AccountLinking recipe or its imports because it is a paid feature and not available in this project.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Merge on Login (Priority: P1)

As a user with an existing account via one provider, when I log in with a new provider using the same email address, I want to be logged into my existing account so that all my data remains unified.

**Why this priority**: Core requirement of the feature to prevent duplicated identities.

**Independent Test**: Can be fully tested by creating an account via email/password, then logging in via Google with the same email, and checking if the user profile and data are unified.

**Acceptance Scenarios**:

1. **Given** a user has an account with email A via Provider 1, **When** they login via Provider 2 with email A, **Then** they are authenticated into the same account and the new provider is linked to their profile.
2. **Given** a user has an account via Provider 1, **When** they sign in via Provider 2 with a different email B, **Then** a separate new account is created.

### User Story 2 - Account Linking Management (Priority: P2)

As a user, I want to see which providers are linked to my account and be able to unlink them if needed.

**Why this priority**: Users need control over their connected identities, especially if they lose access to a third-party account or want to revoke access.

**Independent Test**: Can be tested by navigating to user settings, viewing linked providers, and clicking 'unlink'.

**Acceptance Scenarios**:

1. **Given** a user has multiple linked providers, **When** they view their profile settings, **Then** they see all active providers.
2. **Given** a user has two or more linked providers, **When** they unlink one, **Then** that provider can no longer be used to access the account.
3. **Given** a user has only one provider linked, **When** they attempt to unlink it, **Then** the action is prevented to avoid account lockout.

### Edge Cases

- If a user signs up with a new provider whose email is unverified and claims an email belonging to another verified account, the system will deny the linking process and prompt the user to verify their email address before proceeding.
- If an older user currently holds multiple distinct accounts under the same email (created before deduplication), the system will prompt them to merge accounts upon their next login via an unlinked provider.
- If a user's secondary provider email is changed later to match an entirely different existing account, the system will deny the login attempt, automatically unlink the provider from the previous account, and require the user to verify/link it to the new account manually.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST match incoming authentication requests with existing user accounts based on the email address.
- **FR-002**: System MUST link the new authentication provider's ID to the matched user account upon successful login.
- **FR-003**: System MUST NOT create a new user record if an existing user record shares the exact email address.
- **FR-004**: System MUST allow users to view their linked authentication providers.
- **FR-005**: System MUST allow users to unlink secondary authentication providers.
- **FR-006**: System MUST prevent users from unlinking their only remaining authentication provider.
- **FR-007**: System MUST reject authentication attempts from unverified provider emails if the email matches an existing verified account, requiring email verification before the provider can be linked.
- **FR-008**: System MUST prompt users with pre-existing distinct accounts sharing the same email to merge them upon their next login, requiring explicit user confirmation before completing the merge.
- **FR-009**: System MUST handle cases where a linked provider's underlying email changes to match a different primary account by denying the login attempt, automatically unlinking the provider from its previous account, and requiring manual verification/linking to the new account.
- **FR-010**: System MUST NOT use Supertokens AccountLinking recipe or any of its imports; implement linking without paid AccountLinking features.

### Key Entities *(include if feature involves data)*

- **User**: Represents the unified identity of the individual.
- **LinkedIdentity/Provider**: Represents a specific external authentication method (e.g., Google, Discord, Email/Password) connected to the User.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given the same email address, 100% of multiple-provider logins result in a single User entity.
- **SC-002**: Support queries relating to "lost accounts" due to using the wrong login button decrease by 50%.
- **SC-003**: Linking an additional provider adds minimal overhead, resolving within standard login time expectations (under 2 seconds).

## Assumptions

- Users have stable internet connectivity.
- Third-party social providers provide a reliable, structured email field in their OAuth/OIDC responses.
- Most social providers guarantee email ownership, or we have an existing step to verify it.
