import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import supertokens, { User } from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import UserRoles from "supertokens-node/recipe/userroles";
import {
    SupertokensConfig,
    SupertokensConfigInjectionToken,
} from "./config.interface";
import { AUTH_ERRORS } from "./auth.constants";
import { UserInitService } from "../user/user-init/user-init.service";
import { UserAccountService } from "../user/user-account/user-account.service";

/**
 * The auth service is responsible for setting up and providing Supertokens integration to GameNode. <br>
 * Keep in mind that this service is essential to a lot of GameNode's functionality, and unless you are very familiar with
 * SuperTokens internals/documentation, avoid changing logic here.
 */
@Injectable()
export class AuthService {
    private logger = new Logger(AuthService.name);

    constructor(
        @Inject(SupertokensConfigInjectionToken)
        private config: SupertokensConfig,
        private userInitService: UserInitService,
        private userAccountService: UserAccountService,
    ) {
        supertokens.init({
            appInfo: this.config.appInfo,
            supertokens: {
                connectionURI: this.config.connectionURI,
                apiKey: this.config.apiKey,
            },
            recipeList: [
                ThirdParty.init({
                    signInAndUpFeature: {
                        providers: config.providers,
                    },
                    /**
                     * Custom logic implemented here:
                     * - Implements user initialization logic
                     * - Account linking logic based on verified email addresses to prevent duplicate accounts and unintentional account takeover
                     */
                    override: {
                        apis: (originalImplementation) => ({
                            ...originalImplementation,
                            signInUpPOST: async (input) => {
                                try {
                                    const oAuthTokens =
                                        await this.resolveOAuthTokens(input);
                                    const userInfo =
                                        await input.provider.getUserInfo({
                                            oAuthTokens,
                                            userContext: input.userContext,
                                        });

                                    if (
                                        userInfo.email === undefined &&
                                        // Only considers 'false' if not undefined
                                        input.provider.config?.requireEmail ===
                                            false
                                    ) {
                                        userInfo.email = {
                                            id:
                                                (await input.provider.config.generateFakeEmail?.(
                                                    {
                                                        thirdPartyUserId:
                                                            userInfo.thirdPartyUserId,
                                                        tenantId:
                                                            input.tenantId,
                                                        userContext:
                                                            input.userContext,
                                                    },
                                                )) || "",
                                            isVerified: true,
                                        };
                                    }

                                    if (userInfo.email === undefined) {
                                        return {
                                            status: "NO_EMAIL_GIVEN_BY_PROVIDER",
                                        };
                                    }

                                    const email = userInfo.email;
                                    const users =
                                        await this.userAccountService.getUsersByEmail(
                                            email.id,
                                        );

                                    const linkedProvider =
                                        await this.userAccountService.getLinkedProvider(
                                            input.provider.id,
                                            userInfo.thirdPartyUserId,
                                        );

                                    if (linkedProvider) {
                                        const emailUserIds = new Set(
                                            users.map((user) => user.id),
                                        );

                                        if (
                                            users.length > 0 &&
                                            !emailUserIds.has(
                                                linkedProvider.userId,
                                            )
                                        ) {
                                            await this.userAccountService.unlinkAccount(
                                                input.provider.id,
                                                userInfo.thirdPartyUserId,
                                            );
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    AUTH_ERRORS.PROVIDER_EMAIL_CHANGED,
                                            };
                                        }

                                        const linkedUser =
                                            await this.userAccountService.getUserById(
                                                linkedProvider.userId,
                                            );

                                        if (!linkedUser) {
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    AUTH_ERRORS.PROVIDER_LINK_CONFLICT,
                                            };
                                        }

                                        const recipeUserId =
                                            supertokens.convertToRecipeUserId(
                                                linkedUser.id,
                                            );

                                        const session =
                                            await Session.createNewSession(
                                                input.options.req,
                                                input.options.res,
                                                input.tenantId,
                                                recipeUserId,
                                            );

                                        return {
                                            status: "OK",
                                            createdNewRecipeUser: false,
                                            user: linkedUser,
                                            session,
                                            oAuthTokens,
                                            rawUserInfoFromProvider:
                                                userInfo.rawUserInfoFromProvider,
                                        };
                                    }

                                    // Unverified emails are never linked to existing accounts (takeover risk);
                                    // they fall through and create a separate account instead.
                                    if (users.length > 0 && email.isVerified) {
                                        const targetUser =
                                            this.selectPreferredUser(users);

                                        await this.userAccountService.linkAccounts(
                                            targetUser.id,
                                            input.provider.id,
                                            userInfo.thirdPartyUserId,
                                        );

                                        const recipeUserId =
                                            supertokens.convertToRecipeUserId(
                                                targetUser.id,
                                            );

                                        const session =
                                            await Session.createNewSession(
                                                input.options.req,
                                                input.options.res,
                                                input.tenantId,
                                                recipeUserId,
                                            );

                                        return {
                                            status: "OK",
                                            createdNewRecipeUser: false,
                                            user: targetUser,
                                            session,
                                            oAuthTokens,
                                            rawUserInfoFromProvider:
                                                userInfo.rawUserInfoFromProvider,
                                        };
                                    }

                                    // If no user with the same email exists, continue with the normal flow and create a new user
                                    // The auth code is single-use: drop redirectURIInfo so the SDK reuses our tokens
                                    // instead of exchanging the code a second time (invalid_grant).
                                    const { redirectURIInfo, ...rest } =
                                        input as any;
                                    const nextInput =
                                        redirectURIInfo !== undefined
                                            ? { ...rest, oAuthTokens }
                                            : input;
                                    const result =
                                        await originalImplementation.signInUpPOST!(
                                            nextInput,
                                        );

                                    if (result.status === "OK") {
                                        await this.userInitService.init(
                                            result.user.id,
                                        );
                                    }

                                    return result;
                                } catch (err: any) {
                                    this.logger.error(err);
                                    switch (err.message) {
                                        case AUTH_ERRORS.USER_INIT_ERROR:
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    "Our internal user initialization process failed. Please try again.",
                                            };
                                    }

                                    throw err;
                                }
                            },
                        }),
                    },
                }),
                UserRoles.init(),
                Session.init(),
                Dashboard.init(),
            ],
        });
    }

    async getLinkedProviders(userId: string) {
        return this.userAccountService.getLinkedProviders(userId);
    }

    async unlinkProvider(userId: string, providerId: string) {
        const providers =
            await this.userAccountService.getLinkedProviders(userId);
        if (
            providers.length <= 1 ||
            (providerId !== "passwordless" &&
                providers.some(
                    (provider) => provider.providerId === providerId,
                ) &&
                providers.filter(
                    (provider) => provider.providerId !== "passwordless",
                ).length <= 1)
        ) {
            throw new HttpException(
                "Cannot unlink the last remaining provider.",
                400,
            );
        }
        const provider = providers.find(
            (linkedProvider) => linkedProvider.providerId === providerId,
        );
        if (!provider) {
            throw new HttpException("Provider not linked.", 400);
        }
        await this.userAccountService.unlinkAccount(
            provider.providerId,
            provider.providerUserId,
        );
    }

    private async resolveOAuthTokens(input: any) {
        if ("redirectURIInfo" in input && input.redirectURIInfo !== undefined) {
            return input.provider.exchangeAuthCodeForOAuthTokens({
                redirectURIInfo: input.redirectURIInfo,
                userContext: input.userContext,
            });
        }
        if ("oAuthTokens" in input && input.oAuthTokens !== undefined) {
            return input.oAuthTokens;
        }
        throw new Error("Missing OAuth tokens");
    }

    private hasVerifiedEmailForUser(user: User, emailId: string): boolean {
        return user.loginMethods.some(
            (method) => method.verified && method.hasSameEmailAs?.(emailId),
        );
    }

    private hasVerifiedEmailForAnyUser(
        users: User[],
        emailId: string,
    ): boolean {
        return users.some((user) =>
            this.hasVerifiedEmailForUser(user, emailId),
        );
    }

    private selectPreferredUser(users: User[]): User {
        if (users.length === 1) {
            return users[0];
        }

        // Prefers first created user
        const sortedCandidates = users.toSorted(
            (a, b) => this.getUserTimeJoined(a) - this.getUserTimeJoined(b),
        );

        return sortedCandidates[0];
    }

    private getUserTimeJoined(user: User): number {
        const timeJoined = user.timeJoined;
        return typeof timeJoined === "number" ? timeJoined : 0;
    }
}
