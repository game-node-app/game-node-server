import { Inject, Injectable, Logger } from "@nestjs/common";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import ThirdPartyPasswordless from "supertokens-node/recipe/thirdpartypasswordless";
import UserRoles from "supertokens-node/recipe/userroles";
import {
    SupertokensConfigInjectionToken,
    AuthModuleConfig,
} from "./config.interface";
import { UserInitService } from "../user-init/user-init.service";
import { SMTPService } from "supertokens-node/lib/build/recipe/thirdpartypasswordless/emaildelivery/services";
import * as process from "process";

/**
 * The Auth Service
 * uses SuperTokens to provide authentication
 */
@Injectable()
export class AuthService {
    private logger = new Logger(AuthService.name);

    constructor(
        @Inject(SupertokensConfigInjectionToken)
        private config: AuthModuleConfig,
        private userInitService: UserInitService,
    ) {
        supertokens.init({
            appInfo: this.config.appInfo,
            supertokens: {
                connectionURI: this.config.connectionURI,
                apiKey: this.config.apiKey,
            },
            recipeList: [
                ThirdPartyPasswordless.init({
                    flowType: "USER_INPUT_CODE",
                    contactMethod: "EMAIL",
                    emailDelivery: this.getEmailDeliverySettings(config),
                    providers: config.providers,
                    override: {
                        apis: (originalImplementation) => ({
                            ...originalImplementation,
                            thirdPartySignInUpPOST: async (input) => {
                                const result =
                                    await originalImplementation.thirdPartySignInUpPOST!(
                                        input,
                                    );
                                if (result.status === "OK") {
                                    this.userInitService
                                        .init(result.user.id)
                                        .then()
                                        .catch((e) => console.error(e));
                                }
                                return result;
                            },
                            consumeCodePOST: async (input) => {
                                const result =
                                    await originalImplementation.consumeCodePOST!(
                                        input,
                                    );
                                if (result.status === "OK") {
                                    this.userInitService
                                        .init(result.user.id)
                                        .then()
                                        .catch((e) => console.error(e));
                                }
                                return result;
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

    private getEmailDeliverySettings(config: AuthModuleConfig): any {
        const smtpSettings = config.smtpSettings;
        const requiredFields = [
            smtpSettings.host,
            smtpSettings.port,
            smtpSettings.authUsername,
            smtpSettings.password,
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
                smtpSettings: config.smtpSettings,
            }),
        };
    }
}
