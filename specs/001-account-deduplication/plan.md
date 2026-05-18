# Implementation Plan: Account Deduplication

**Branch**: `001-account-deduplication` | **Date**: 2026-05-17 | **Spec**: /specs/001-account-deduplication/spec.md

**Input**: Feature specification from `/specs/001-account-deduplication/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Implement account deduplication across Supertokens providers by matching accounts on verified email, linking providers to a single User, and handling merge-on-login, unlink safeguards, and email-change conflicts. Must not use Supertokens AccountLinking recipe or any of its imports; implement linking logic with existing Supertokens APIs and local data models.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript (NestJS; Node.js)

**Primary Dependencies**: NestJS, TypeORM, Supertokens (supertokens-node)

**Storage**: MySQL (TypeORM), Redis (caching/queues)

**Testing**: Jest (unit/integration), Supertest (e2e)

**Target Platform**: Linux server (Docker)

**Project Type**: Web service (NestJS API)

**Performance Goals**: Login/account-linking paths <2s end-to-end

**Constraints**: Must not use Supertokens AccountLinking recipe/imports (paid feature).

**Scale/Scope**: Production user base; expect multiple providers per user

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Gate 1: Code Quality & Maintainability**: Must keep auth logic decoupled via services, avoid massive files, follow lint/format rules.
**Gate 2: Testing Standards**: Add unit/integration coverage for linking/merge flows; tests map to User Stories.
**Gate 3: UX/API Consistency**: Auth errors returned in consistent format; validation fails fast with actionable errors.
**Gate 4: Performance & Scalability**: Avoid N+1 lookups during login; index email/provider fields; consider caching if needed.

## Phase 0: Research

- Confirm Supertokens APIs used for email-based lookup and provider linking (no AccountLinking recipe/imports).
- Review existing auth overrides to ensure custom dedup logic can be inserted without changing core Supertokens flow.

## Phase 1: Design & Contracts

- Define data model updates and constraints for linked providers and dedup tracking.
- Specify API contracts for listing/unlinking providers and merge prompts.
- Update quickstart steps for local validation of auth flows.

## Phase 2: Implementation Plan

- Implement email-based account matching in auth sign-in/up overrides.
- Persist provider links using `LinkedProvider` for each successful secondary login.
- Enforce unlink guardrails (cannot remove last provider) and expose linked-provider list.
- Handle email-change collision by denying login, unlinking provider, and requiring manual re-link.
- Add tests for merge-on-login, unlink guard, and email-change collision behavior.

## Implementation Notes

- Do not use Supertokens AccountLinking recipe or any related imports under any circumstances (paid feature).

## Project Structure

### Documentation (this feature)

```text
specs/001-account-deduplication/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
src/
├── auth/
├── user/
│   ├── user-account/
│   └── user-init/
├── interceptor/
└── utils/

test/
├── e2e/
└── unit/
```

**Structure Decision**: Single NestJS API in `src/` with feature modules; tests in `test/`.

## Constitution Check (Post-Design)

- Code Quality & Maintainability: Planned changes stay within auth/user-account services; no new massive files.
- Testing Standards: Coverage planned for all acceptance scenarios and edge cases.
- UX/API Consistency: Errors standardized via existing auth error handling.
- Performance & Scalability: Email/provider lookup uses indexed columns; avoid extra queries on login.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
