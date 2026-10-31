import {
    Controller,
    Get,
    INestApplication,
    Module,
    UseGuards,
    VersioningType,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { json } from "express";
import request from "supertest";
import { toNodeHandler } from "better-auth/node";
import { AuthModule } from "./auth.module";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { Public } from "./public.decorator";
import { Roles } from "./roles.decorator";
import { Session, SessionContainer } from "./session.decorator";
import { EUserRoles } from "../utils/constants";
import { UploadModule } from "../upload/upload.module";
import { NotificationsModule } from "../notifications/notifications.module";

/**
 * Runs Better Auth against the dev MySQL (yarn migration:run first). Provider HTTP calls are stubbed on the
 * provider objects, so each sign-in goes through the real /sign-in/social -> /callback/:provider flow.
 */

@Controller("auth-test")
@UseGuards(AuthGuard)
class AuthTestController {
    @Get("me")
    me(@Session() session: SessionContainer) {
        return { userId: session.getUserId() };
    }

    @Get("public")
    @Public()
    anonymous(@Session() session?: SessionContainer) {
        return { userId: session?.getUserId() ?? null };
    }

    @Get("editor")
    @Roles([EUserRoles.EDITOR, EUserRoles.ADMIN])
    editor() {
        return { ok: true };
    }
}

// Stands in for NotificationsModule so the spec doesn't register BullMQ queues against dev Redis.
@Module({})
class NoNotificationsModule {}

type Profile = { id: string; email?: string; emailVerified: boolean };

jest.setTimeout(60000);

const EMAIL_DOMAIN = "auth-int.test";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = 24 * 60 * 60 * 1000;

describe("Better Auth integration (dev MySQL)", () => {
    let app: INestApplication;
    let authService: AuthService;
    let dataSource: DataSource;
    let website: string;
    const nextProfile: Record<string, Profile> = {};

    const email = () => `${randomUUID()}@${EMAIL_DOMAIN}`;
    const server = () => app.getHttpServer();
    const ctx = () => authService.auth.$context;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                TypeOrmModule.forRoot({
                    type: "mysql",
                    host: process.env.DB_HOST,
                    port: Number(process.env.DB_PORT),
                    username: process.env.DB_USER,
                    password: process.env.DB_PASS,
                    database: process.env.DB_DATABASE,
                    timezone: "Z",
                    entities: [`${__dirname}/../**/*.entity.ts`],
                    retryAttempts: 0,
                }),
                UploadModule,
                AuthModule,
            ],
            controllers: [AuthTestController],
        })
            .overrideModule(NotificationsModule)
            .useModule(NoNotificationsModule)
            .compile();

        app = moduleRef.createNestApplication({ bodyParser: false });
        authService = app.get(AuthService);
        dataSource = app.get(DataSource);
        website = app.get(ConfigService).getOrThrow("DOMAIN_WEBSITE");
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        // Same mounting as main.ts.
        app.getHttpAdapter()
            .getInstance()
            .all("/v1/auth/*splat", toNodeHandler(authService.auth));
        app.use(json());
        await app.init();

        for (const provider of (await ctx()).socialProviders as any[]) {
            provider.validateAuthorizationCode = async () => ({
                accessToken: "stub-access-token",
            });
            provider.accountSubject = ({ profile }: { profile: Profile }) =>
                profile.id;
            provider.getUserInfo = async () => {
                const profile = nextProfile[provider.id];
                return {
                    user: {
                        id: profile.id,
                        email: profile.email,
                        emailVerified: profile.emailVerified,
                        name: "Auth test",
                    },
                    data: profile,
                };
            };
        }
    });

    afterAll(async () => {
        if (!app) return;
        const rows: { id: string }[] = await dataSource.query(
            "SELECT id FROM `user` WHERE email LIKE ?",
            [`%@${EMAIL_DOMAIN}`],
        );
        const ids = rows.map((row) => row.id);
        if (ids.length > 0) {
            await dataSource.query("DELETE FROM library WHERE userId IN (?)", [
                ids,
            ]);
            await dataSource.query("DELETE FROM profile WHERE userId IN (?)", [
                ids,
            ]);
            await dataSource.query("DELETE FROM `user` WHERE id IN (?)", [ids]);
        }
        await app.close();
    });

    /**
     * Drives the provider flow and returns the callback redirect plus, on success, the bearer token.
     * Pass a bearer token to link the identity to that signed-in user instead.
     */
    async function oauth(
        provider: string,
        profile: Profile,
        linkWithToken?: string,
    ) {
        nextProfile[provider] = profile;
        const agent = request.agent(server());
        const start = linkWithToken
            ? agent
                  .post("/v1/auth/link-social")
                  .set("Authorization", `Bearer ${linkWithToken}`)
            : agent.post("/v1/auth/sign-in/social");
        const started = await start
            .set("Origin", website)
            .send({ provider, callbackURL: website })
            .expect(200);
        const state = new URL(started.body.url).searchParams.get("state");
        const callback = await agent
            .get(`/v1/auth/callback/${provider}`)
            .query({ code: "stub-code", state })
            .expect(302);
        const location = new URL(callback.headers.location);
        return {
            error: location.searchParams.get("error"),
            location: callback.headers.location as string,
            token: callback.headers["set-auth-token"] as string | undefined,
            agent,
        };
    }

    async function signIn(provider: string, profile: Profile) {
        const result = await oauth(provider, profile);
        expect(result.error).toBeNull();
        expect(result.token).toBeDefined();
        const me = await bearer("get", "/v1/auth-test/me", result.token!);
        return { ...result, token: result.token!, userId: me.body.userId };
    }

    function bearer(
        method: "get" | "post",
        path: string,
        token: string,
        body?: object,
    ) {
        const req = request(server())
            [method](path)
            .set("Authorization", `Bearer ${token}`)
            .set("Origin", website);
        return body ? req.send(body) : req;
    }

    const usersByEmail = (address: string) =>
        dataSource.query("SELECT * FROM `user` WHERE email = ?", [address]);
    const accountsOf = (userId: string) =>
        dataSource.query("SELECT * FROM account WHERE userId = ?", [userId]);
    const sessionsOf = (userId: string) =>
        dataSource.query("SELECT * FROM session WHERE userId = ?", [userId]);

    async function makeAdmin() {
        const admin = await signIn("google", {
            id: randomUUID(),
            email: email(),
            emailVerified: true,
        });
        await (
            await ctx()
        ).internalAdapter.updateUser(admin.userId, {
            role: "user,admin",
        });
        return admin;
    }

    describe("social sign-in", () => {
        it.each(["google", "discord", "twitter"])(
            "%s creates one user, one account, init records and a session",
            async (provider) => {
                const address = email();
                const { userId, location } = await signIn(provider, {
                    id: randomUUID(),
                    email: address,
                    emailVerified: true,
                });

                expect(location).toBe(website);
                expect(userId).toMatch(UUID);
                const users = await usersByEmail(address);
                expect(users).toHaveLength(1);
                expect(users[0].role).toBe("user");
                expect(await accountsOf(userId)).toHaveLength(1);
                expect(await sessionsOf(userId)).toHaveLength(1);
                for (const [table, column] of [
                    ["profile", "userId"],
                    ["library", "userId"],
                    ["user_level", "userId"],
                ]) {
                    const rows = await dataSource.query(
                        `SELECT 1 FROM ${table} WHERE ${column} = ?`,
                        [userId],
                    );
                    expect(rows).toHaveLength(1);
                }
            },
        );

        it("creates no user or session when the provider returns no email", async () => {
            const before = await dataSource.query(
                "SELECT COUNT(*) AS c FROM `user`",
            );
            const { error, token } = await oauth("twitter", {
                id: randomUUID(),
                emailVerified: false,
            });
            expect(error).toBe("email_not_found");
            expect(token).toBeUndefined();
            expect(
                await dataSource.query("SELECT COUNT(*) AS c FROM `user`"),
            ).toEqual(before);
        });

        it("rejects an unknown provider without starting a flow", async () => {
            const response = await request(server())
                .post("/v1/auth/sign-in/social")
                .set("Origin", website)
                .send({ provider: "nope", callbackURL: website });
            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.body.url).toBeUndefined();
        });

        it("signs a linked identity in to its owner even after its email changes", async () => {
            const identity = randomUUID();
            const first = await signIn("google", {
                id: identity,
                email: email(),
                emailVerified: true,
            });
            const again = await signIn("google", {
                id: identity,
                email: email(),
                emailVerified: true,
            });
            expect(again.userId).toBe(first.userId);
            expect(await accountsOf(first.userId)).toHaveLength(1);
        });

        it("re-runs init on sign-in so a missing profile is created", async () => {
            const identity = randomUUID();
            const address = email();
            const first = await signIn("google", {
                id: identity,
                email: address,
                emailVerified: true,
            });
            await dataSource.query("DELETE FROM profile WHERE userId = ?", [
                first.userId,
            ]);
            await signIn("google", {
                id: identity,
                email: address,
                emailVerified: true,
            });
            expect(
                await dataSource.query(
                    "SELECT 1 FROM profile WHERE userId = ?",
                    [first.userId],
                ),
            ).toHaveLength(1);
        });
    });

    describe("account linking", () => {
        it("links a second provider reporting the same verified email", async () => {
            const address = email();
            const google = await signIn("google", {
                id: randomUUID(),
                email: address,
                emailVerified: true,
            });
            const discord = await signIn("discord", {
                id: randomUUID(),
                email: address.toUpperCase(),
                emailVerified: true,
            });
            expect(discord.userId).toBe(google.userId);
            expect(await usersByEmail(address)).toHaveLength(1);
            expect(await accountsOf(google.userId)).toHaveLength(2);
        });

        it("rejects an unlinked identity whose matching email is unverified", async () => {
            const address = email();
            const google = await signIn("google", {
                id: randomUUID(),
                email: address,
                emailVerified: true,
            });
            const sessionsBefore = (await sessionsOf(google.userId)).length;
            const { error, token } = await oauth("discord", {
                id: randomUUID(),
                email: address,
                emailVerified: false,
            });
            expect(error).toBe("account_not_linked");
            expect(token).toBeUndefined();
            expect(await usersByEmail(address)).toHaveLength(1);
            expect(await accountsOf(google.userId)).toHaveLength(1);
            expect(await sessionsOf(google.userId)).toHaveLength(
                sessionsBefore,
            );
        });

        it("explicitly links a provider with a matching email", async () => {
            const address = email();
            const google = await signIn("google", {
                id: randomUUID(),
                email: address,
                emailVerified: true,
            });
            const { error } = await oauth(
                "twitter",
                { id: randomUUID(), email: address, emailVerified: true },
                google.token,
            );
            expect(error).toBeNull();
            const accounts = await accountsOf(google.userId);
            expect(accounts.map((a: any) => a.providerId).sort()).toEqual([
                "google",
                "twitter",
            ]);
        });

        it("refuses to link an identity owned by another user", async () => {
            const twitterIdentity = randomUUID();
            const ownerEmail = email();
            const owner = await signIn("twitter", {
                id: twitterIdentity,
                email: ownerEmail,
                emailVerified: true,
            });
            const otherEmail = email();
            const other = await signIn("google", {
                id: randomUUID(),
                email: otherEmail,
                emailVerified: true,
            });
            const { error } = await oauth(
                "twitter",
                {
                    id: twitterIdentity,
                    email: otherEmail,
                    emailVerified: true,
                },
                other.token,
            );
            expect(error).toBe("account_already_linked_to_different_user");
            expect(await accountsOf(owner.userId)).toHaveLength(1);
            expect(await accountsOf(other.userId)).toHaveLength(1);
        });

        it("lists and unlinks one of several providers, but never the last", async () => {
            const address = email();
            const discordIdentity = randomUUID();
            const google = await signIn("google", {
                id: randomUUID(),
                email: address,
                emailVerified: true,
            });
            await signIn("discord", {
                id: discordIdentity,
                email: address,
                emailVerified: true,
            });
            const listed = await bearer(
                "get",
                "/v1/auth/list-accounts",
                google.token,
            ).expect(200);
            expect(listed.body.map((a: any) => a.providerId).sort()).toEqual([
                "discord",
                "google",
            ]);

            const accountIdOf = (providerId: string) =>
                listed.body.find((a: any) => a.providerId === providerId).id;
            await bearer("post", "/v1/auth/unlink-account", google.token, {
                accountId: accountIdOf("discord"),
            }).expect(200);
            expect(await accountsOf(google.userId)).toHaveLength(1);

            const last = await bearer(
                "post",
                "/v1/auth/unlink-account",
                google.token,
                { accountId: accountIdOf("google") },
            );
            expect(last.status).toBe(400);
            expect(await accountsOf(google.userId)).toHaveLength(1);

            // The removed link no longer resolves to this user: with the email unverified it can't relink either.
            const { error } = await oauth("discord", {
                id: discordIdentity,
                email: address,
                emailVerified: false,
            });
            expect(error).toBe("account_not_linked");
        });
    });

    describe("session resolution", () => {
        it("accepts a valid bearer token or session cookie and rejects anything else", async () => {
            const result = await oauth("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            await bearer("get", "/v1/auth-test/me", result.token!).expect(200);
            await result.agent.get("/v1/auth-test/me").expect(200);
            await request(server()).get("/v1/auth-test/me").expect(401);
            await bearer("get", "/v1/auth-test/me", "not-a-token").expect(401);
        });

        it("runs public routes anonymously and still exposes a signed-in user", async () => {
            const anonymous = await request(server())
                .get("/v1/auth-test/public")
                .expect(200);
            expect(anonymous.body).toEqual({ userId: null });
            const { token, userId } = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            const signedIn = await bearer(
                "get",
                "/v1/auth-test/public",
                token,
            ).expect(200);
            expect(signedIn.body).toEqual({ userId });
        });

        it("rejects a token after sign-out", async () => {
            const { token } = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            await bearer("post", "/v1/auth/sign-out", token, {}).expect(200);
            await bearer("get", "/v1/auth-test/me", token).expect(401);
        });
    });

    describe("roles and admin API", () => {
        it("gives 403 on role-restricted routes without a matching role", async () => {
            const { token } = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            await bearer("get", "/v1/auth-test/editor", token).expect(403);
        });

        it("ignores a role sent by the client", async () => {
            const { token, userId } = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            await bearer("post", "/v1/auth/update-user", token, {
                role: "admin",
            });
            expect(await authService.getUserRoles(userId)).toEqual(["user"]);
        });

        it("lets an admin list users and set roles to user,editor", async () => {
            const admin = await makeAdmin();
            const target = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });

            const list = await bearer(
                "get",
                "/v1/auth/admin/list-users?limit=1000",
                admin.token,
            ).expect(200);
            const listed = list.body.users.find(
                (u: any) => u.id === target.userId,
            );
            expect(listed).toMatchObject({ role: "user" });
            expect(listed).toHaveProperty("banned");

            await bearer("post", "/v1/auth/admin/set-role", admin.token, {
                userId: target.userId,
                role: ["user", "editor"],
            }).expect(200);
            expect(await authService.getUserRoles(target.userId)).toEqual([
                "user",
                "editor",
            ]);
            await bearer("get", "/v1/auth-test/editor", target.token).expect(
                200,
            );
        });

        it("rejects an unknown role", async () => {
            const admin = await makeAdmin();
            const target = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            const response = await bearer(
                "post",
                "/v1/auth/admin/set-role",
                admin.token,
                { userId: target.userId, role: "superuser" },
            );
            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(await authService.getUserRoles(target.userId)).toEqual([
                "user",
            ]);
        });

        it.each(["user", "user,mod", "user,editor"])(
            "gives 403 on admin operations to %s",
            async (role) => {
                const caller = await signIn("google", {
                    id: randomUUID(),
                    email: email(),
                    emailVerified: true,
                });
                const target = await signIn("google", {
                    id: randomUUID(),
                    email: email(),
                    emailVerified: true,
                });
                await (
                    await ctx()
                ).internalAdapter.updateUser(caller.userId, {
                    role,
                });
                await bearer(
                    "get",
                    "/v1/auth/admin/list-users",
                    caller.token,
                ).expect(403);
                await bearer("post", "/v1/auth/admin/ban-user", caller.token, {
                    userId: target.userId,
                }).expect(403);
                await bearer("post", "/v1/auth/admin/set-role", caller.token, {
                    userId: target.userId,
                    role: "admin",
                }).expect(403);
                expect(await authService.getUserRoles(target.userId)).toEqual([
                    "user",
                ]);
                expect(
                    (await authService.getLockoutStates([target.userId])).get(
                        target.userId,
                    ),
                ).toEqual({ isSuspended: false, isBanned: false });
            },
        );

        it("rejects impersonation even for an admin", async () => {
            const admin = await makeAdmin();
            const target = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            const sessionsBefore = (await sessionsOf(target.userId)).length;
            await bearer(
                "post",
                "/v1/auth/admin/impersonate-user",
                admin.token,
                { userId: target.userId },
            ).expect(403);
            expect(await sessionsOf(target.userId)).toHaveLength(
                sessionsBefore,
            );
        });
    });

    describe("lockouts", () => {
        it("revokes sessions at once and rejects sign-in while active", async () => {
            const identity = randomUUID();
            const address = email();
            const { token, userId } = await signIn("google", {
                id: identity,
                email: address,
                emailVerified: true,
            });

            await authService.lockOut(userId, {
                reason: "test",
                expiresIn: 14 * DAY,
            });

            await bearer("get", "/v1/auth-test/me", token).expect(401);
            expect(await sessionsOf(userId)).toHaveLength(0);
            expect(
                (await authService.getLockoutStates([userId])).get(userId),
            ).toEqual({ isSuspended: true, isBanned: false });
            const retry = await oauth("google", {
                id: identity,
                email: address,
                emailVerified: true,
            });
            expect(retry.error).toBe("BANNED_USER");
            expect(retry.token).toBeUndefined();
            expect(await sessionsOf(userId)).toHaveLength(0);
        });

        it("reports a lockout without expiry as a ban", async () => {
            const { userId } = await signIn("google", {
                id: randomUUID(),
                email: email(),
                emailVerified: true,
            });
            await authService.lockOut(userId, { reason: "test" });
            expect(
                (await authService.getLockoutStates([userId])).get(userId),
            ).toEqual({ isSuspended: false, isBanned: true });
        });

        it("lets a user sign in once their suspension has expired", async () => {
            const identity = randomUUID();
            const address = email();
            const { userId } = await signIn("google", {
                id: identity,
                email: address,
                emailVerified: true,
            });
            await (
                await ctx()
            ).internalAdapter.updateUser(userId, {
                banned: true,
                banReason: "test",
                banExpires: new Date(Date.now() - DAY),
            });
            expect(
                (await authService.getLockoutStates([userId])).get(userId),
            ).toEqual({ isSuspended: false, isBanned: false });
            const again = await signIn("google", {
                id: identity,
                email: address,
                emailVerified: true,
            });
            expect(again.userId).toBe(userId);
        });
    });
});
