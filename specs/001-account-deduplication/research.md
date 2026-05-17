# Research: Account Deduplication with SuperTokens

## Decision: Account Linkage Mechanism
**Decision:** Override `signInUpPOST` in `ThirdParty.init` (and potentially `consumeCodePOST` in `Passwordless.init`) to manually handle account linkage.
**Rationale:** SuperTokens provides automatic account linking (deduplication) as a paid feature. We must implement it manually. By overriding the `signInUpPOST` API logic before we call `originalImplementation` or by intercepting the auth payload, we can query users by email. If an account with the same email exists, we can use the `supertokens-node` built-in manual linking module or directly add the third-party sign-in to the existing `User` entity and create a session for the existing User, rather than creating a new identity in SuperTokens.
**Alternatives considered:** Paying for the managed feature (rejected due to cost). Client-side prompted linkage (UX mismatch with requirements for auto-link unless an old conflicting account exists).

## Decision: Edge Case Handling
**Decision:** Return standard error formats from overridden hooks when emails are unverified or when older duplicate accounts conflict.
**Rationale:** The `spec.md` states we must prompt users if they have a legacy duplicate account, or reject if the email is unverified. We can throw customized errors or return `GENERAL_ERROR` with custom metadata to the client.

