import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import supertokens, { User } from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import Passwordless from "supertokens-node/recipe/passwordless";
import UserRoles from "supertokens-node/recipe/userroles";
import {
    SupertokensConfig,
    SupertokensConfigInjectionToken,
} from "./config.interface";
import { AUTH_ERRORS } from "./auth.constants";
import { SMTPServiceConfig } from "supertokens-node/lib/build/ingredients/emaildelivery/services/smtp";
import { EMAIL_CONFIG_TOKEN } from "../global/global.tokens";
import { SMTPService } from "supertokens-node/recipe/passwordless/emaildelivery";
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
        @Inject(EMAIL_CONFIG_TOKEN)
        private readonly emailConfig: SMTPServiceConfig,
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
                Passwordless.init({
                    flowType: "USER_INPUT_CODE",
                    contactMethod: "EMAIL",
                    emailDelivery: this.getEmailDeliverySettings(
                        this.emailConfig,
                    ),
                    /**
                     * Custom logic implemented here:
                     * - Implements user initialization logic
                     * - Account linking logic based on verified email addresses to prevent duplicate accounts and unintentional account takeover
                     */
                    override: {
                        apis: (originalImplementation) => ({
                            ...originalImplementation,
                            consumeCodePOST: async (input) => {
                                try {
                                    const result =
                                        await originalImplementation.consumeCodePOST!(
                                            input,
                                        );
                                    if (result.status !== "OK") {
                                        return result;
                                    }

                                    const email = result.user.emails[0];
                                    // Shouldn't happen in practice
                                    if (!email) {
                                        if (result.createdNewRecipeUser) {
                                            await this.userInitService.init(
                                                result.user.id,
                                            );
                                        }
                                        return result;
                                    }

                                    const users =
                                        await this.userAccountService.getUsersByEmail(
                                            email,
                                        );
                                    const providerId = "passwordless";
                                    const providerUserId = result.user.id;
                                    const linkedProvider =
                                        await this.userAccountService.getLinkedProvider(
                                            providerId,
                                            providerUserId,
                                        );

                                    const loginEmailVerified =
                                        this.hasVerifiedEmailForUser(
                                            result.user,
                                            email,
                                        );
                                    const hasVerifiedEmail =
                                        this.hasVerifiedEmailForAnyUser(
                                            users,
                                            email,
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
                                                providerId,
                                                providerUserId,
                                            );
                                            await result.session.revokeSession();
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
                                            await result.session.revokeSession();
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    AUTH_ERRORS.PROVIDER_LINK_CONFLICT,
                                            };
                                        }

                                        if (
                                            !loginEmailVerified &&
                                            !hasVerifiedEmail
                                        ) {
                                            await result.session.revokeSession();
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    AUTH_ERRORS.UNVERIFIED_EMAIL_REQUIRED,
                                            };
                                        }

                                        if (linkedUser.id !== result.user.id) {
                                            await result.session.revokeSession();
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
                                            };
                                        }

                                        if (result.createdNewRecipeUser) {
                                            await this.userInitService.init(
                                                result.user.id,
                                            );
                                        }

                                        return result;
                                    }

                                    if (users.length > 0) {
                                        if (
                                            !loginEmailVerified &&
                                            !hasVerifiedEmail
                                        ) {
                                            await result.session.revokeSession();
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    AUTH_ERRORS.UNVERIFIED_EMAIL_REQUIRED,
                                            };
                                        }

                                        const targetUser =
                                            this.selectPreferredUser(users);

                                        await this.userAccountService.linkAccounts(
                                            targetUser.id,
                                            providerId,
                                            providerUserId,
                                        );

                                        if (targetUser.id !== result.user.id) {
                                            await result.session.revokeSession();
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
                                            };
                                        }

                                        if (result.createdNewRecipeUser) {
                                            await this.userInitService.init(
                                                result.user.id,
                                            );
                                        }

                                        return result;
                                    }

                                    if (result.createdNewRecipeUser) {
                                        await this.userInitService.init(
                                            result.user.id,
                                        );
                                    }

                                    return result;
                                } catch (err) {
                                    this.logger.error(err);
                                    switch (err.message) {
                                        case AUTH_ERRORS.USER_INIT_ERROR:
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    "Our internal user initialization process failed. Please go back and try again.",
                                            };
                                    }
                                    throw err;
                                }
                            },
                        }),
                    },
                }),
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

                                        const hasVerifiedEmail =
                                            this.hasVerifiedEmailForAnyUser(
                                                users,
                                                email.id,
                                            );

                                        if (
                                            !email.isVerified &&
                                            !hasVerifiedEmail
                                        ) {
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    AUTH_ERRORS.UNVERIFIED_EMAIL_REQUIRED,
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

                                    if (users.length > 0) {
                                        const targetUser =
                                            this.selectPreferredUser(users);
                                        const hasVerifiedEmail =
                                            this.hasVerifiedEmailForAnyUser(
                                                users,
                                                email.id,
                                            );

                                        if (
                                            !email.isVerified &&
                                            !hasVerifiedEmail
                                        ) {
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    AUTH_ERRORS.UNVERIFIED_EMAIL_REQUIRED,
                                            };
                                        }

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
                                    const nextInput =
                                        "redirectURIInfo" in input
                                            ? { ...input, oAuthTokens }
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

    private getEmailDeliverySettings(config: SMTPServiceConfig): any {
        const requiredFields = [
            config.host,
            config.port,
            config.authUsername,
            config.password,
        ];
        const hasEmptyField = requiredFields.some(
            (field) => field == undefined,
        );
        if (hasEmptyField) {
            this.logger.warn(
                `No email service configured - Supertokens default API service will be used to send emails.`,
            );
            return undefined;
        }
        return {
            service: new SMTPService({
                smtpSettings: config,
            }),
        };
    }

    async getLinkedProviders(userId: string) {
        return this.userAccountService.getLinkedProviders(userId);
    }

    async unlinkProvider(userId: string, providerId: string) {
        const providers =
            await this.userAccountService.getLinkedProviders(userId);
        if (providers.length <= 1) {
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
