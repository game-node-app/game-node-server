# Tasks: Account Deduplication

**Input**: Design documents from `specs/001-account-deduplication/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Dependencies & Execution Graph

1. **Setup & Foundational**: Must establish new custom error constants and database primitives for querying accounts by email.
2. **User Story 1 (Merge on Login)**: P1 Priority. MVP goal. Depends on Foundation. Enables cross-provider authentication without duplication.
3. **User Story 2 (Account Linking Management)**: P2 Priority. Can be built after US1.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Define `UNVERIFIED_EMAIL_CONFLICT` and `DUPLICATE_LEGACY_ACCOUNTS` errors in `src/auth/auth.constants.ts`

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

- [X] T002 Implement database queries to fetch user accounts by email in `src/user/user-account/user-account.service.ts`
- [X] T003 Implement manual third-party linking database helper in `src/user/user-account/user-account.service.ts`

## Phase 3: User Story 1 - Merge on Login (Priority: P1) 🎯 MVP

**Goal**: Seamlessly log users into existing accounts when emails match, or properly reject them based on security conditions.

**Independent Test**: Create an account via email/password, then log in via Google with the same email, and verify standard successful authentication into the primary account.

### Implementation for User Story 1

- [ ] T004 [US1] Create unit tests for ThirdParty `signInUpPOST` override honoring merge conditions in `src/auth/auth.service.spec.ts`
- [ ] T005 [US1] Override `signInUpPOST` in `ThirdParty.init` inside `src/auth/auth.service.ts` to query user emails prior to passing control to original implementation
- [ ] T006 [US1] Implement automatic account linkage for matching verified emails in `signInUpPOST` override inside `src/auth/auth.service.ts`
- [ ] T007 [P] [US1] Implement rejection behavior returning `UNVERIFIED_EMAIL_CONFLICT` for unverified emails matching verified accounts in `src/auth/auth.service.ts`
- [ ] T008 [P] [US1] Implement rejection behavior returning `DUPLICATE_LEGACY_ACCOUNTS` for pre-existing legacy collisions in `src/auth/auth.service.ts`

## Phase 4: User Story 2 - Account Linking Management (Priority: P2)

**Goal**: Allow users to manage (view and unlink) connected provider identities.

**Independent Test**: Navigate to user settings, view linked providers, attempt to unlink one (success) and attempt to unlink the last one (fail).

### Implementation for User Story 2

- [ ] T009 [P] [US2] Create unit tests for provider unlinking logic and constraints in `src/auth/auth.service.spec.ts`
- [ ] T010 [US2] Add `getLinkedProviders` logic to `src/auth/auth.service.ts`
- [ ] T011 [US2] Add `unlinkProvider` logic to `src/auth/auth.service.ts` enforcing the minimum 1 provider rule
- [ ] T012 [P] [US2] Expose `GET /auth/providers` endpoint in `src/auth/auth.controller.ts`
- [ ] T013 [P] [US2] Expose `DELETE /auth/providers/:providerId` endpoint in `src/auth/auth.controller.ts`

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T014 Incorporate unified Swagger definitions for the new error codes in `src/auth/auth.controller.ts`
- [ ] T015 Verify E2E suite passes and add any final integration tests in `test/app.e2e-spec.ts`
