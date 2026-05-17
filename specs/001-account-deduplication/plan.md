# Implementation Plan: Account Deduplication

**Branch**: `001-account-deduplication` | **Date**: 2026-05-17 | **Spec**: [spec.md](../spec.md)

**Input**: Feature specification from `specs/001-account-deduplication/spec.md`

## Summary

Implement account deduplication by overriding Supertokens hooks and functions to automatically link multiple login methods to the same user account via email matching, avoiding the costly paid feature while preserving user identities.

## Technical Context

**Language/Version**: TypeScript / Node.js 22
**Primary Dependencies**: NestJS 11, TypeORM, supertokens-node (v22)
**Storage**: MySQL, Redis
**Testing**: Jest, Supertest
**Target Platform**: Linux server
**Project Type**: web-service
**Performance Goals**: < 2 seconds for login operations
**Constraints**: Supertokens paid feature not available; must implement manually via API overrides.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*
- Code Quality & Maintainability: Passes. Core business logic remains contained within the `AuthService` and helper modules.
- Testing Standards: Tests will need to be written mapping to the scenarios (duplicate accounts, auto-merge new login, unverified mismatch).
- User Experience and API Consistency: We are reusing standard `GENERAL_ERROR` with structured payload strings.
- High Performance & Scalability: Manual linking via DB calls shouldn't overhead standard auth flows significantly.

## Project Structure

### Documentation (this feature)

```text
specs/001-account-deduplication/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output 
```

### Source Code (repository root)

```text
src/
├── auth/
│   ├── auth.service.ts
│   ├── auth.service.spec.ts
│   └── auth.constants.ts
```

**Structure Decision**: Keep standard Single Project module layout. We will expand the existing `auth/auth.service.ts` configuration to inject the custom linking logic.

## Complexity Tracking

*No major complexity violations.*
