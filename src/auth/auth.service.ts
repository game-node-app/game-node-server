import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import type { IncomingMessage } from "http";
import { betterAuth } from "better-auth";
import { capacitor } from "better-auth-capacitor";
import { fromNodeHeaders } from "better-auth/node";
import { admin, bearer, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { createPool } from "mysql2/promise";
import { UserInitService } from "../user/user-init/user-init.service";
import { EUserRoles } from "../utils/constants";
import { MCP_PATH, MCP_SCOPES } from "../mcp/mcp.constants";

const ac = createAccessControl(defaultStatements);

const roles = {
    // Nobody may impersonate: admins get every default permission except impersonation.
    [EUserRoles.ADMIN]: ac.newRole({
        ...adminAc.statements,
        user: adminAc.statements.user.filter(
            (permission) => !permission.startsWith("impersonate"),
        ),
    }),
    // Mods lock users out only through report handling, which enforces the 14-day limit.
    [EUserRoles.MOD]: ac.newRole({ user: [], session: [] }),
    [EUserRoles.EDITOR]: ac.newRole({ user: [], session: [] }),
    [EUserRoles.USER]: ac.newRole({ user: [], session: [] }),
};

export interface LockoutState {
    isSuspended: boolean;
    isBanned: boolean;
}

/**
 * Owns the in-process Better Auth instance, mounted at /v1/auth in main.ts.
 */
@Injectable()
export class AuthService implements OnModuleDestroy {
    readonly auth;
    private readonly pool;

    constructor(configService: ConfigService, moduleRef: ModuleRef) {
        const provider = (name: string) => ({
            clientId: configService.getOrThrow<string>(
                `PROVIDER_${name}_CLIENT_ID`,
            ),
            clientSecret: configService.getOrThrow<string>(
                `PROVIDER_${name}_CLIENT_SECRET`,
            ),
        });

        this.pool = createPool({
            host: configService.getOrThrow<string>("DB_HOST"),
            port: Number(configService.getOrThrow("DB_PORT")),
            user: configService.getOrThrow<string>("DB_USER"),
            password: configService.getOrThrow<string>("DB_PASS"),
            database: configService.getOrThrow<string>("DB_DATABASE"),
            timezone: "Z",
        });

        const apiUrl = configService.getOrThrow<string>("DOMAIN_API");
        const websiteUrl = configService.getOrThrow<string>("DOMAIN_WEBSITE");

        this.auth = betterAuth({
            appName: "GameNode",
            baseURL: apiUrl,
            basePath: "/v1/auth",
            secret: configService.getOrThrow<string>("BETTER_AUTH_SECRET"),
            trustedOrigins: [
                configService.getOrThrow<string>("DOMAIN_WEBSITE"),
                ...(configService.get<string>("TRUSTED_ORIGINS") ?? "")
                    .split(",")
                    .map((origin) => origin.trim())
                    .filter(Boolean),
            ],
            database: this.pool,
            advanced: { database: { generateId: "uuid" } },
            socialProviders: {
                google: provider("GOOGLE"),
                discord: provider("DISCORD"),
                twitter: provider("TWITTER"),
            },
            account: {
                encryptOAuthTokens: true,
                accountLinking: {
                    enabled: true,
                    trustedProviders: [],
                    allowDifferentEmails: false,
                    allowUnlinkingAll: false,
                },
            },
            databaseHooks: {
                session: {
                    create: {
                        // Runs on every sign-in so a failed init heals on the next one; a throw aborts the sign-in.
                        before: async (session) => {
                            // Resolved lazily: UserInitService -> ProfileService -> AuthService would be a constructor cycle.
                            await moduleRef
                                .get(UserInitService, { strict: false })
                                .init(session.userId);
                        },
                    },
                },
            },
            plugins: [
                bearer(),
                capacitor(),
                admin({
                    ac,
                    roles,
                    adminRoles: [EUserRoles.ADMIN],
                    defaultRole: EUserRoles.USER,
                }),
                jwt(),
                mcp({
                    resource: `${apiUrl}${MCP_PATH}`,
                    loginPage: `${websiteUrl}/auth`,
                    consentPage: `${websiteUrl}/oauth/consent`,
                    scopes: MCP_SCOPES,
                    allowDynamicClientRegistration: true,
                    allowUnauthenticatedClientRegistration: true,
                    clientRegistrationDefaultApplicationType: "infer",
                }),
                cimd({
                    fetchClientMetadataResource,
                    metadataProfile: "mcp-2026-07-28",
                }),
            ],
        });
    }

    async onModuleDestroy() {
        await this.pool.end();
    }

    async getSession(req: IncomingMessage) {
        return this.auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });
    }

    async getUserRoles(userId: string): Promise<string[]> {
        const ctx = await this.auth.$context;
        const user = await ctx.internalAdapter.findUserById(userId);
        return parseRoles((user as { role?: unknown } | null)?.role);
    }

    /**
     * Same steps as the admin plugin's banUser, which can't be called without an admin session.
     * Omit expiresIn for a permanent ban.
     */
    async lockOut(
        userId: string,
        { reason, expiresIn }: { reason: string; expiresIn?: number },
    ) {
        const ctx = await this.auth.$context;
        await ctx.internalAdapter.updateUser(userId, {
            banned: true,
            banReason: reason,
            banExpires:
                expiresIn !== undefined
                    ? new Date(Date.now() + expiresIn)
                    : null,
        });
        await ctx.internalAdapter.deleteUserSessions(userId);
        // Stops MCP clients from refreshing: access tokens are short-lived JWTs, refresh tokens are not.
        for (const model of ["oauthRefreshToken", "oauthConsent"]) {
            await ctx.adapter.deleteMany({
                model,
                where: [{ field: "userId", value: userId }],
            });
        }
    }

    /**
     * The plugin clears expired bans only on the next sign-in attempt, so banExpires is checked here too.
     */
    async getLockoutStates(
        userIds: string[],
    ): Promise<Map<string, LockoutState>> {
        const states = new Map<string, LockoutState>();
        if (userIds.length === 0) return states;
        const ctx = await this.auth.$context;
        const users = await ctx.adapter.findMany<{
            id: string;
            banned?: boolean | null;
            banExpires?: Date | null;
        }>({
            model: "user",
            where: [{ field: "id", operator: "in", value: userIds }],
        });
        for (const user of users) {
            const active =
                !!user.banned &&
                (user.banExpires == null ||
                    new Date(user.banExpires).getTime() > Date.now());
            states.set(user.id, {
                isSuspended: active && user.banExpires != null,
                isBanned: active && user.banExpires == null,
            });
        }
        return states;
    }
}

export function parseRoles(role: unknown): string[] {
    return typeof role === "string" && role.length > 0 ? role.split(",") : [];
}
