import { Inject, Injectable, Logger } from "@nestjs/common";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import Passwordless from "supertokens-node/recipe/passwordless";
import UserRoles from "supertokens-node/recipe/userroles";
import {
    SupertokensConfigInjectionToken,
    SupertokensConfig,
} from "./config.interface";
import { UserInitService } from "../user-init/user-init.service";
import { AUTH_ERRORS } from "./auth.constants";
import { SMTPServiceConfig } from "supertokens-node/lib/build/ingredients/emaildelivery/services/smtp";
import { EMAIL_CONFIG_TOKEN } from "../global/global.tokens";
import { SMTPService } from "supertokens-node/recipe/passwordless/emaildelivery";

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
                     * - Handles account deduplication
                     * https://supertokens.com/docs/thirdpartypasswordless/common-customizations/deduplication/overview
                     */
                    override: {
                        apis: (originalImplementation) => ({
                            ...originalImplementation,
                            createCodePOST: async (input) => {
                                if ("email" in input) {
                                    const existingUsers =
                                        await supertokens.listUsersByAccountInfo(
                                            input.tenantId,
                                            {
                                                email: input.email,
                                            },
                                        );
                                    // New user trying to sign-up
                                    if (existingUsers.length === 0) {
                                        return originalImplementation.createCodePOST!(
                                            input,
                                        );
                                    }
                                    const isUsualLoginMethod =
                                        existingUsers.some((existingUser) => {
                                            return existingUser.loginMethods.some(
                                                (loginMethod) => {
                                                    const isSameEmail =
                                                        loginMethod.hasSameEmailAs(
                                                            input.email,
                                                        );
                                                    const isSameMethod =
                                                        loginMethod.recipeId ===
                                                        "passwordless";
                                                    return (
                                                        isSameEmail &&
                                                        isSameMethod
                                                    );
                                                },
                                            );
                                        });
                                    if (isUsualLoginMethod) {
                                        return originalImplementation.createCodePOST!(
                                            input,
                                        );
                                    }

                                    return {
                                        status: "GENERAL_ERROR",
                                        message:
                                            "It seems like you already have an account with us. Please sign-in with the usual method.",
                                    };
                                }

                                // Phone number based login.
                                // Not currently used by GameNode, but we maintain the logic here to avoid problems.
                                return originalImplementation.createCodePOST!(
                                    input,
                                );
                            },
                            consumeCodePOST: async (input) => {
                                try {
                                    const result =
                                        await originalImplementation.consumeCodePOST!(
                                            input,
                                        );
                                    if (result.status === "OK") {
                                        if (result.status === "OK") {
                                            await this.userInitService.init(
                                                result.user.id,
                                            );
                                        }
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
                     * - Handles account deduplication
                     * https://supertokens.com/docs/thirdpartypasswordless/common-customizations/deduplication/overview
                     */
                    override: {
                        functions: (originalImplementation) => ({
                            ...originalImplementation,
                            signInUp: async (input) => {
                                const existingUsers =
                                    await supertokens.listUsersByAccountInfo(
                                        input.tenantId,
                                        {
                                            email: input.email,
                                        },
                                    );
                                if (existingUsers.length === 0) {
                                    // A new user is trying to sign-in.
                                    return originalImplementation.signInUp(
                                        input,
                                    );
                                }
                                // Checks if user is trying to sign-in using the previously used third party provider
                                const isUsualLoginMethod = existingUsers.some(
                                    (existingUser) => {
                                        return existingUser.loginMethods.some(
                                            (loginMethod) => {
                                                const isThirdPartyProvider =
                                                    loginMethod.recipeId ===
                                                    "thirdparty";
                                                const isSameProvider =
                                                    loginMethod.hasSameThirdPartyInfoAs(
                                                        {
                                                            id: input.thirdPartyId,
                                                            userId: input.thirdPartyUserId,
                                                        },
                                                    );

                                                return (
                                                    isThirdPartyProvider &&
                                                    isSameProvider
                                                );
                                            },
                                        );
                                    },
                                );
                                if (isUsualLoginMethod) {
                                    return originalImplementation.signInUp(
                                        input,
                                    );
                                }
                                throw new Error(
                                    AUTH_ERRORS.DUPLICATE_ACCOUNT_ERROR,
                                );
                            },
                        }),
                        apis: (originalImplementation) => ({
                            ...originalImplementation,
                            signInUpPOST: async (input) => {
                                try {
                                    const result =
                                        await originalImplementation.signInUpPOST!(
                                            input,
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
                                        case AUTH_ERRORS.DUPLICATE_ACCOUNT_ERROR:
                                            return {
                                                status: "GENERAL_ERROR",
                                                message:
                                                    "It seems like you already have an account with us. Please sign-in with the usual method.",
                                            };
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
}
