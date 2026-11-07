import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
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
import { stripe, type StripeOptions } from "@better-auth/stripe";
import Stripe from "stripe";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { createPool } from "mysql2/promise";
import { UserInitService } from "../user/user-init/user-init.service";
import { SupporterSubscriptionStartService } from "../billing/supporter-subscription-start.service";
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

/** Row shape of the Better Auth Stripe plugin's `subscription` table (design D4/D5). */
export interface SupporterSubscriptionRow {
    id: string;
    plan: string;
    referenceId: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    status:
        | "active"
        | "canceled"
        | "incomplete"
        | "incomplete_expired"
        | "past_due"
        | "paused"
        | "trialing"
        | "unpaid";
    periodStart?: Date;
    periodEnd?: Date;
    trialStart?: Date;
    trialEnd?: Date;
    cancelAtPeriodEnd?: boolean;
    cancelAt?: Date;
    canceledAt?: Date;
    endedAt?: Date;
    seats?: number;
    billingInterval?: "day" | "week" | "month" | "year";
    stripeScheduleId?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Owns the in-process Better Auth instance, mounted at /v1/auth in main.ts.
 */
@Injectable()
export class AuthService implements OnModuleDestroy {
    readonly auth;
    readonly stripeEnabled: boolean;
    readonly stripe: Stripe | null;
    private readonly logger = new Logger(AuthService.name);
    private readonly pool;

    constructor(
        configService: ConfigService,
        moduleRef: ModuleRef,
        supporterStarts: SupporterSubscriptionStartService,
    ) {
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

        // All four values are required to sell; local development and CI boot without Stripe (design D3).
        const stripeSecretKey = configService.get<string>("STRIPE_SECRET_KEY");
        const stripeWebhookSecret = configService.get<string>(
            "STRIPE_WEBHOOK_SECRET",
        );
        const monthlyPriceId = configService.get<string>(
            "STRIPE_PRICE_SUPPORTER_MONTHLY",
        );
        const yearlyPriceId = configService.get<string>(
            "STRIPE_PRICE_SUPPORTER_YEARLY",
        );
        const stripeConfig =
            stripeSecretKey &&
            stripeWebhookSecret &&
            monthlyPriceId &&
            yearlyPriceId
                ? {
                      client: new Stripe(stripeSecretKey),
                      webhookSecret: stripeWebhookSecret,
                      monthlyPriceId,
                      yearlyPriceId,
                  }
                : null;
        this.stripe = stripeConfig?.client ?? null;
        this.stripeEnabled = stripeConfig !== null;
        const logSubscription = async ({
            subscription,
        }: {
            subscription: SupporterSubscriptionRow;
        }) =>
            this.logger.log(
                `Stripe subscription ${subscription.plan} ${subscription.status}, period ends ${
                    subscription.periodEnd
                        ? new Date(subscription.periodEnd).toISOString()
                        : "unknown"
                }`,
            );

        const onSubscriptionChange = async (data: {
            subscription: SupporterSubscriptionRow;
            // Only these fields are read; the plugin's hook types resolve Stripe's ESM build.
            stripeSubscription: Pick<Stripe.Subscription, "id" | "start_date">;
        }) => {
            await logSubscription(data);
            try {
                await supporterStarts.record(
                    data.stripeSubscription.id,
                    data.subscription.referenceId,
                    new Date(data.stripeSubscription.start_date * 1000),
                );
            } catch (error) {
                // A duplicate or out-of-order webhook must not fail the hook.
                this.logger.warn(
                    `Could not record supporter start for ${data.stripeSubscription.id}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        };

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
                ...(stripeConfig
                    ? [
                          stripe({
                              // The plugin's ESM types resolve stripe's ESM build; ours are CJS (identical runtime).
                              stripeClient:
                                  stripeConfig.client as unknown as StripeOptions["stripeClient"],
                              stripeWebhookSecret: stripeConfig.webhookSecret,
                              createCustomerOnSignUp: false,
                              subscription: {
                                  enabled: true,
                                  plans: [
                                      {
                                          name: "supporter",
                                          priceId: stripeConfig.monthlyPriceId,
                                          annualDiscountPriceId:
                                              stripeConfig.yearlyPriceId,
                                      },
                                  ],
                                  authorizeReference: async ({
                                      user,
                                      referenceId,
                                  }) => referenceId === user.id,
                                  // Stripe Tax is unavailable for this account's country; the advertised prices are the total.
                                  getCheckoutSessionParams: (
                                      _data,
                                      _req,
                                      ctx,
                                  ) => ({
                                      params: {
                                          // Stripe does not localize multi-currency Prices on its own.
                                          currency:
                                              ctx.body?.metadata?.currency ===
                                              "brl"
                                                  ? "brl"
                                                  : "usd",
                                          allow_promotion_codes: true,
                                      },
                                  }),
                                  onSubscriptionComplete: onSubscriptionChange,
                                  onSubscriptionUpdate: onSubscriptionChange,
                                  onSubscriptionCancel: logSubscription,
                                  onSubscriptionDeleted: logSubscription,
                              },
                          }),
                      ]
                    : []),
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

    async getSubscriptions(
        userId: string,
    ): Promise<SupporterSubscriptionRow[]> {
        if (!this.stripeEnabled) return [];
        const ctx = await this.auth.$context;
        return ctx.adapter.findMany<SupporterSubscriptionRow>({
            model: "subscription",
            where: [{ field: "referenceId", value: userId }],
        });
    }
}

export function parseRoles(role: unknown): string[] {
    return typeof role === "string" && role.length > 0 ? role.split(",") : [];
}
