# Proposal

## Why

We want to ship an MCP server, and later a desktop client. Both need GameNode to act as an OAuth 2.1 authorization server. In SuperTokens that is a paid add-on with no public price, and account linking is also paid ($0.005/MAU, $100/month minimum), which is why we maintain a hand-rolled `linked_provider` workaround. Better Auth is fully open source and covers social login, account linking, and (through `@better-auth/oauth-provider` / `@better-auth/mcp`) the OAuth server we need next. There are no real users yet, so we can swap the identity store now without a data migration.

## What Changes

- Replace `supertokens-node` with `better-auth` (1.7.x) in the NestJS server, running in-process against the existing MySQL database. No separate auth container.
- Keep the same social providers and provider ids: `google`, `discord`, `twitter`, using the existing `PROVIDER_*` credentials.
- Replace the custom `linked_provider` account linking with Better Auth's native account linking: a provider sign-in whose email matches an existing user and is verified by the provider joins that user.
- Keep the existing `AuthGuard`, `@Session()`, `@Public()` and `@Roles()` contract so the ~50 controllers keep working with `session.getUserId()`. Sessions are accepted from the Better Auth cookie or an `Authorization: Bearer` token.
- Add Better Auth's admin plugin. User roles (`user`, `admin`, `mod`, `editor`) live in its `role` column, and every new user defaults to `user`. Admins get the plugin's user-management API under `/v1/auth/admin/*` (list users, set roles, ban/unban, list/revoke sessions). Impersonation is not granted to any role.
- **BREAKING:** replace the GameNode suspension system with Better Auth bans. A report-driven suspension becomes a 14-day ban and a ban becomes a permanent ban. Locked-out users can't sign in, including to their library, and their sessions are revoked. Mods and admins can suspend; only admins can permanently ban. The `user_suspension` table, `SuspensionGuard`, `SuspensionService` and `SuspensionModule` are deleted.
- Initialize GameNode user data (profile, library, level) on sign-in, idempotently, so a failed init heals on the next sign-in.
- One TypeORM migration creates the Better Auth tables (`user`, `session`, `account`, `verification`, including the admin plugin's columns) and drops every SuperTokens table plus `linked_provider` and `user_suspension`. After `yarn migration:run`, the dev MySQL `gamenode` database has Better Auth tables and no SuperTokens tables.
- Remove the SuperTokens core service from both compose files, the SuperTokens database and user from `docker/mysql/init-databases.sh`, and the SuperTokens env vars. Add `BETTER_AUTH_SECRET`.
- **BREAKING (clients):** the auth HTTP API under `/v1/auth/*` becomes Better Auth's API (`/sign-in/social`, `/callback/:provider`, `/get-session`, `/sign-out`, `/list-accounts`, `/unlink-account`, ...). The custom `GET /v1/auth/logout`, `GET /v1/auth/providers` and `DELETE /v1/auth/providers/:providerId` endpoints are removed in favor of those built-ins. Existing SuperTokens sessions and user ids stop working.
- **BREAKING (ops):** each provider's OAuth console must allow the new redirect URI `${DOMAIN_API}/v1/auth/callback/<provider>`.

### Non-goals

- Frontend clients (web, admin, mobile). They get their own changes.
- The OAuth/MCP authorization server itself (`@better-auth/mcp`, `jwt()`). It is a follow-up change on top of this one.
- Email/password, passwordless, MFA, and the paid Better Auth Infrastructure dashboard. None are used today.
- Moving external game connections (Steam, Xbox, PSN) into Better Auth. They stay in the `connection` module.
- Deleting orphaned domain rows (profiles, libraries, reviews) that point to old SuperTokens user ids. Reset the dev DB if a clean slate is wanted.

## Capabilities

### New Capabilities
- `user-auth`: user sign-in through social providers, session resolution for API requests, account linking between providers, user roles and admin user management, suspensions and bans, and first-sign-in user initialization.

### Modified Capabilities
None. Existing specs only say "authenticated session" generically, and `content-reactions` / `engagement-statistics` only require that suspended or banned accounts are rejected. That still holds, because locked-out accounts can't authenticate.

## Impact

- **Code:** `src/auth/**` (rewritten), `src/main.ts` (handler mount, body parsing, CORS, filter), `src/suspension/**` (deleted), `src/report/report.service.ts`, `src/activities/activities-repository/activities-repository.service.ts`, `src/profile/profile.service.ts`, the reviews/comment/posts/statistics controllers and modules that use `SuspensionGuard`, `src/interceptor/session-aware-cache/**`, `src/user/user-init/**`, `src/user/user-account/**` (drops `LinkedProvider`), `src/utils/getUserRoles.ts` and `src/utils/checkUserHasRole.ts` (deleted, unused), and every controller importing `SessionContainer` from `supertokens-node` (import path only).
- **Tests:** `src/auth/auth.service.spec.ts`, `src/user/user-init/user-init.service.spec.ts`, `src/blog/blog-post/blog-http.integration.spec.ts`, `src/report/report.service.integration.spec.ts`, `src/statistics/statistics-reaction.controller.spec.ts`, `src/suspension/suspension.service.spec.ts` (deleted), `src/utils/db/mysql-init.spec.ts`, `src/search/manticore-deployment.spec.ts`, `docker/cms/check-delivery.ts`. Plus a new account-linking integration spec.
- **Dependencies:** add `better-auth`; remove `supertokens-node`. `mysql2` is already installed. Jest config must handle Better Auth's ESM-only build.
- **Infra:** `docker-compose.yml`, `docker-compose.prod.yml`, `docker/mysql/init-databases.sh`, `.env.example`, docs that mention SuperTokens. The production `supertokens` database is left in place for a manual drop after rollout.
- **Database:** new migration under `src/migrations/`.
