# Research: Account Deduplication with SuperTokens

## Decision: Account Linkage Mechanism
**Decision:** Override `signInUpPOST` in `ThirdParty.init` (and potentially `consumeCodePOST` in `Passwordless.init`) to manually handle account linkage using existing Supertokens APIs and local data models.
**Rationale:** Account linking/deduplication via the Supertokens AccountLinking recipe is a paid feature and must not be used. Instead, we will query users by email, select the canonical user, and persist provider links in `LinkedProvider`, then establish sessions for the canonical user.
**Alternatives considered:** Paying for the managed feature (rejected due to cost). Client-side prompted linkage (UX mismatch with requirements for auto-link unless an old conflicting account exists).

## Decision: Edge Case Handling
**Decision:** Return standard error formats from overridden hooks when emails are unverified or when older duplicate accounts conflict.
**Rationale:** The `spec.md` states we must prompt users if they have a legacy duplicate account, or reject if the email is unverified. We can throw customized errors or return `GENERAL_ERROR` with custom metadata to the client.
