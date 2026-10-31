# Design

## Context

See proposal.md (Why). Current state:

- `AuthService` calls `supertokens.init()` in its constructor with ThirdParty (`google`, `discord`, `twitter`), Session, UserRoles and Dashboard recipes. Its `signInUpPOST` override implements email-based linking on top of our own `linked_provider` table, because SuperTokens account linking is paid.
- `AuthMiddleware` serves SuperTokens' `/v1/auth/*` routes. `AuthGuard` calls `verifySession` and checks role claims. `@Session()` returns `req.session`, a SuperTokens `SessionContainer`. 56 call sites only use `session.getUserId()`, and about 34 files import the `SessionContainer` type.
- Suspensions and bans live in GameNode's `user_suspension` table. They only block community writes: `SuspensionGuard` on reviews/comments/posts/statistics routes, plus `ActivitiesRepositoryService.validateCreate` for background activity creation. Users can still sign in. `ReportService.handle` writes the suspension row inside the same TypeORM transaction that deletes content and writes the moderation notification. `SuspensionService.checkBanPermission` reads roles from session claims, and `ProfileService.findAll` exposes `isSuspended`/`isBanned`. Report handling is restricted to `mod`/`admin`.
- `UserInitService` creates roles at boot and assigns `user` on signup.
- `src/utils/getUserRoles.ts` and `checkUserHasRole.ts` have no callers. `JwtAuthService`/`JwtAuthGuard` are referenced only from each other and `auth.guard.ts` docs.
- In dev, the SuperTokens core writes 45 tables into the same `gamenode` database. In prod it uses a separate `supertokens` database. None of the 45 names collide with a TypeORM table.
- `package.json` is `"type": "commonjs"` with TS 5.8 and `module: NodeNext`. The Docker image is `node:22`. `better-auth@1.7.14` is ESM-only (`.mjs`). Jest 29 with `ts-jest` only transforms `.ts`/`.js`.
- Some DTOs validate user ids with `@IsUUID()` (for example, `authorId` in statistics).

## Goals / Non-Goals

**Goals:**
- Preserve the controller-facing auth contract (`AuthGuard`, `@Session()`, `@Public()`, `@Roles()`, `session.getUserId()`), so controllers only change one import line.
- Use Better Auth built-ins wherever they cover today's behavior, and delete the custom code they replace.
- Keep a single schema source of truth: TypeORM migrations.

**Non-Goals:**
- Client-specific behavior (cookie domain for web SSR, mobile origins, deep links). These are decided in the client changes.
- Session storage in Redis, or the OAuth/MCP provider plugins.
- Keeping community-only restrictions. The user chose full lockout: suspended or banned users lose sign-in, library included.

## Decisions

### 1. Better Auth runs in-process, owned by `AuthService`
`AuthService` builds `this.auth = betterAuth({...})` in its constructor from `ConfigService`, the same way it calls `supertokens.init()` today. `AuthModule` becomes `@Global()` and exports `AuthService`, so `AuthGuard` and any service can inject it from any module. This drops `config.interface.ts`, the config injection token, `AuthMiddleware`, `AuthController` and `auth.filter.ts`. `AuthService` also exposes `getUserRoles(userId)`, `lockOut(userId, { reason, expiresIn? })` and `getLockoutStates(userIds)` (decision 10).
- *Alternative:* `@thallesp/nestjs-better-auth`. Rejected: it brings its own guard and decorators, which would mean rewriting ~50 controllers, and it is community-maintained.

Config outline:
```ts
betterAuth({
  baseURL: DOMAIN_API, basePath: "/v1/auth", secret: BETTER_AUTH_SECRET,
  trustedOrigins: [DOMAIN_WEBSITE],
  database: createPool({ host, port, user, password, database, timezone: "Z" }), // mysql2/promise
  advanced: { database: { generateId: "uuid" } },
  socialProviders: { google, discord, twitter }, // PROVIDER_* env
  account: {
    encryptOAuthTokens: true,
    accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false, allowUnlinkingAll: false },
  },
  databaseHooks: { session: { create: { before: async (s) => { await userInitService.init(s.userId); } } } },
  plugins: [bearer(), admin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" })], // decision 3
})
```

### 2. Account linking uses Better Auth defaults, and `linked_provider` is deleted
Better Auth's `account` table (`providerId`, `accountId`, `userId`) is what `linked_provider` stored. Behavior compared with today:
- **Same:** a linked identity signs in to its owner. A verified email links to the existing user. You cannot unlink the last provider.
- **Changed:** an unverified email that matches an existing user is now rejected (`account_not_linked`). Today it creates a duplicate account, which Better Auth can't do because `user.email` is unique. The `PROVIDER_EMAIL_CHANGED` auto-unlink and the "prefer the oldest user" tie-break go away, since a single user owns each email.
- **New for free:** explicit linking (`/link-social`) for a signed-in user, restricted to the same email by `allowDifferentEmails: false`.
`trustedProviders` stays empty so linking always depends on the provider's verified flag, which matches today's rule.

### 3. Roles and admin API come from the admin plugin
The admin plugin adds `role` (default `"user"`, not client-writable), `banned`, `banReason` and `banExpires` to `user`, and `impersonatedBy` to `session`. Multiple roles are stored comma-separated (`"user,editor"`), which the plugin supports natively. Access control is configured explicitly with `createAccessControl(defaultStatements)`:
- `admin`: `adminAc.statements` minus `impersonate` and `impersonate-admins`, so nobody can impersonate.
- `mod`, `editor`, `user`: empty roles. They exist so `setRole` accepts them, but grant no admin-API permissions. Mods lock users out only through report handling, where our code enforces the 14-day limit. Giving mods the plugin's `ban` permission would let them issue permanent bans through `/admin/ban-user`.
- `adminUserIds` stays empty, because it bypasses access control.
`AuthGuard` checks `@Roles()` with any-of semantics against `user.role.split(",")`. `AuthService.getUserRoles(userId)` reads the user record and replaces session-claim role checks.
- *Alternative:* a plain `additionalFields.role` column (the earlier plan). Replaced at the user's request, to get the admin API and real lockouts now.

### 4. Session contract kept with a thin shim
`AuthService.getSession(req)` calls `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`. `AuthGuard` puts `{ getUserId: () => user.id, user, session }` on `req.session` and throws `UnauthorizedException` (401) or `ForbiddenException` (403). `@Public()` routes skip the 401. `src/auth/session.decorator.ts` exports a `SessionContainer` type, and the 29 files importing it are repointed there. `SessionAwareCacheInterceptor` keeps reading `req.session`. `SuspensionGuard` is deleted: a locked-out user has no session, so `AuthGuard` already rejects them with 401.
`bearer()` keeps header-based sessions working, which SuperTokens also supported.

### 5. HTTP mounting in `main.ts`
Better Auth must read the raw request body, so:
1. `NestFactory.create(AppModule, { bodyParser: false })`.
2. `app.enableCors({... allowedHeaders: ["content-type", "authorization"], exposedHeaders: ["set-auth-token"] })`. This must come first so CORS also covers auth routes.
3. `app.getHttpAdapter().getInstance().all("/v1/auth/*splat", toNodeHandler(app.get(AuthService).auth))`. This uses `all` with a wildcard rather than `app.use("/v1/auth")`, because Express strips mount prefixes and Better Auth routes by full path. Nest 11 uses Express 5, which needs a named wildcard.
4. Then `app.use(json({ limit: "15mb" }))` and `app.use(urlencoded({ extended: true }))`, replacing Nest's default parsers.
`SupertokensExceptionFilter` and `supertokens.getAllCORSHeaders()` are removed.

### 6. User initialization runs on every session creation
`databaseHooks.session.create.before` calls `UserInitService.init(userId)`. Its steps already check for existing rows, so it is idempotent. Running it on every sign-in, rather than only after user creation, heals users whose earlier init failed. Today's code has exactly that hole: a user whose init failed is never initialized again. A thrown error aborts the session, so the sign-in fails visibly. Role setup leaves `UserInitService` (the column default covers it), along with the boot-time `createUserRoles`.

### 7. One TypeORM migration owns the schema
Generate the Better Auth MySQL DDL once with Better Auth's schema tooling (`better-auth/db/migration` `getMigrations(...).compileMigrations()`, or the CLI `generate`) from the final config, including the `role` column. Paste the DDL into `src/migrations/<ts>-ReplaceSupertokensWithBetterAuth.ts`. `up` creates `user`, `session`, `account` and `verification` (with the admin plugin columns), drops `linked_provider` and `user_suspension`, and runs `DROP TABLE IF EXISTS` over the explicit list of 45 SuperTokens tables with `FOREIGN_KEY_CHECKS=0`. In prod those tables live in a different database, so the drop is a no-op there. `down` drops the Better Auth tables and recreates `linked_provider` and `user_suspension` from `InitialSchema` DDL. SuperTokens tables are not restored: the core recreates them on boot.
- *Alternative:* let Better Auth migrate at runtime. Rejected: that creates two schema owners and lets an untracked DDL path run in prod.

### 8. Jest and runtime handling of the ESM-only package
Runtime: Node ≥22.12 `require(esm)` loads `better-auth` from compiled CJS, and TS 5.8 `module: NodeNext` allows that import. Jest's module loader does not, so the main Jest config transforms Better Auth's ESM dependencies: `.mjs` handled by `ts-jest`, and `transformIgnorePatterns` un-ignores `better-auth`, `@better-auth/*`, `better-call`, `@better-fetch/*`, `jose`, `nanostores`, `@noble/*` and `defu`. This is verified first (task 1.2). Fallback if it fights back: `jest.mock` Better Auth in unit specs and run DB-backed auth specs with `NODE_OPTIONS=--experimental-vm-modules`.
- *Applied (task 1.2):* `ts-jest` can't do this, because TypeScript always emits `.mjs` (and `.js` in `type: module` packages under `NodeNext`) as ESM. Instead, `test/esm-transformer.js` runs `ts.transpileModule` with `module: CommonJS` under a `.js` file name, and handles every un-ignored `node_modules` `.js`/`.mjs` file. `kysely` and `rou3` are added to the un-ignore list. The fallback was not needed.
- *Subsequent upgrade:* Node 24.9+ and Jest 30 load Better Auth as ESM from CommonJS tests with `--experimental-vm-modules`; the custom transformer and dependency allowlist have been removed.

### 9. Tests
- `src/auth/auth.integration.spec.ts`, against the dev MySQL, the same way `blog-http.integration.spec.ts` uses real services. It boots the Nest app with the `main.ts` mounting, replaces the `google`/`discord` provider objects' `validateAuthorizationCode`/`getUserInfo` on `(await auth.$context).socialProviders` with stubs, and drives `POST /v1/auth/sign-in/social` and then `GET /v1/auth/callback/:provider` with the issued state cookie. It asserts the `user-auth` scenarios: new user and init, returning identity, verified-email link, unverified rejection, unlink-last refusal, bearer 401/200, sign-out. If stubbing the context objects proves brittle, stub `fetch` for the provider hosts instead.
- `blog-http.integration.spec.ts` creates users and sessions through `(await auth.$context).internalAdapter` (`createUser` with `role`, `createSession`) and sends `Authorization: Bearer <token>`, so no email/password plugin is needed.
- The same auth integration spec covers the admin API: admin lists users and sets roles, non-admin gets 403, impersonation is rejected, an unknown role is rejected, and a lockout revokes the bearer session (401) and blocks the next sign-in, while an expired suspension (`banExpires` in the past) allows it.
- `report.service.integration.spec.ts` replaces the `SuspensionService` mock with an `AuthService` mock (`getUserRoles`, `lockOut`). It asserts that suspend calls `lockOut` with a 14-day expiry, ban by an admin calls it without one, ban by a mod gets 400 with no call, alert/discard make no call, and a forced transaction failure after `lockOut` leaves the report open.
- `statistics-reaction.controller.spec.ts` drops its `SuspensionGuard` override. The "suspended" case becomes an `AuthGuard` override that rejects, matching how a locked-out account now fails.
- `auth.service.spec.ts` and `suspension.service.spec.ts` are deleted. The logic they tested is gone, and the specs above cover the replacements.

### 10. Suspensions and bans become Better Auth lockouts
- **Applying:** `AuthService.lockOut(userId, { reason, expiresIn? })` uses `internalAdapter.updateUser(userId, { banned: true, banReason, banExpires })` and then `internalAdapter.deleteSessions(userId)`, the same steps the plugin's `banUser` performs. Server code can't call `auth.api.banUser` without an admin session, and mods have no plugin `ban` permission. `ReportService.handle` keeps its rule that only admins issue bans (via `getUserRoles`).
- **Ordering in `ReportService.handle`:** call `lockOut` **before** the TypeORM transaction that deletes content, writes the moderation notification and closes the report. If the transaction fails, the user stays locked out but the report stays open and no notification exists. Retrying re-applies the same lockout (idempotent) and commits. The reverse order could notify about a lockout that never happened, which would break `notification-delivery`'s "committed outcomes" rule.
  - *Alternative:* raw SQL on `user`/`session` inside the TypeORM transaction for atomicity. Rejected: it couples to Better Auth's tables and would silently miss sessions if `secondaryStorage` is enabled later.
- **Suspend vs ban:** suspend means `expiresIn` = 14 days, matching today's `endDate`. Ban has no expiry.
- **Active check:** `banned && (banExpires == null || banExpires > now)`. The plugin clears expired bans only on the next sign-in attempt, so our checks must honor `banExpires` themselves.
- **Background activities:** `ActivitiesRepositoryService.validateCreate` replaces `checkIsSuspendedOrBanned` with the active check through `getLockoutStates([userId])`.
- **Profile listing:** `ProfileService.findAll` gets every profile's state in one `getLockoutStates(userIds)` call. That call uses `ctx.adapter.findMany({ model: "user", where: [{ field: "id", operator: "in", value: ids }] })` and replaces today's two queries per profile. `isSuspended` means an active lockout with an expiry, and `isBanned` means an active lockout without one.
- **Deleted:** `src/suspension/**`, and `SuspensionModule` imports in the app, statistics, reviews, activities-repository, comment, posts, report and profile modules.

## Risks / Trade-offs

- [Better Auth is ESM-only on a CJS Nest app] → Spike first (tasks 1.1–1.2): `nest build` + `node dist/src/main` on Node 22, and one Jest spec importing `AuthService`. Fallbacks are in decision 8.
- [Per-request DB lookup for sessions (SuperTokens verified JWTs locally)] → Acceptable at current scale, since it is a PK lookup. A follow-up can enable `secondaryStorage` on the existing Redis if latency shows up.
- [Session lifetime changes from SuperTokens' refresh model to Better Auth's default 7-day rolling session] → Accepted. It can be tuned with `session.expiresIn` without spec changes.
- [Unverified-email collisions now fail instead of creating a second account] → Intended and safer. The error surfaces as `account_not_linked` for clients to handle.
- [Provider callback URLs move from the website to the API] → Ops must register `${DOMAIN_API}/v1/auth/callback/{google,discord,twitter}` before deploying.
- [Twitter/X may not return an email] → Same outcome as today (sign-in refused). The integration spec covers the no-email path.
- [Orphaned domain rows keyed by old SuperTokens ids in dev/prod] → Harmless. Reset the dev DB if a clean slate is wanted.
- [Bootstrapping the first admin: the admin API needs an existing admin] → One-time SQL `UPDATE user SET role = 'user,admin' WHERE email = ...`, documented in the infra report.
- [Suspensions now cost users their library access for 14 days] → Accepted product decision (full lockout).
- [Mods can't use the plugin's ban/session endpoints directly] → Intended. Mods act through report handling. Grant per-permission later if needed.
- [Lockout and report transaction are not atomic] → Lockout-first ordering plus idempotent retry (decision 10). The worst case is a locked-out user with an open report.

## Migration Plan

1. Merge with the migration. In dev: `docker compose rm -sf supertokens`, then `yarn migration:run`, and confirm with `SHOW TABLES`.
2. Prod: add `BETTER_AUTH_SECRET` in Coolify, register the provider callback URLs, and deploy. After the first sign-in, promote the first admin with SQL. Later admins are managed through the admin API. `server_migration` runs the migration and the `supertokens` service disappears from the compose file.
3. After verifying sign-in in prod, manually `DROP DATABASE supertokens` and the SuperTokens DB user.
- Rollback: redeploy the previous image and compose file, then run the migration `down`. The SuperTokens core recreates its tables and sessions start over. Nothing is lost, since there are no real users.

## Open Questions

- Cookie scope for the web client (`advanced.crossSubDomainCookies` on `gamenode.app`) and extra trusted origins for the mobile app. Both are config-only and are decided in the client changes.
