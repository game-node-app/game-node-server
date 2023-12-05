import { Inject, Injectable, Logger } from "@nestjs/common";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import ThirdPartyPasswordless from "supertokens-node/recipe/thirdpartypasswordless";
import UserRoles from "supertokens-node/recipe/userroles";
import jwt from "supertokens-node/recipe/jwt";

import {
    SupertokensConfigInjectionToken,
    AuthModuleConfig,
} from "./config.interface";
import { UserInitService } from "./user-init/user-init.service";

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
                jwt.init(),
                ThirdPartyPasswordless.init({
                    flowType: "USER_INPUT_CODE",
                    contactMethod: "EMAIL",
                    override: {
                        apis: (originalImplementation) => ({
                            ...originalImplementation,
                            thirdPartySignInUpPOST: async (input) => {
                                const result =
                                    await originalImplementation.thirdPartySignInUpPOST!(
                                        input,
                                    );
                                if (result.status === "OK") {
                                    await this.userInitService.initUser(
                                        result.user.id,
                                    );
                                }
                                return result;
                            },
                            consumeCodePOST: async (input) => {
                                const result =
                                    await originalImplementation.consumeCodePOST!(
                                        input,
                                    );
                                if (result.status === "OK") {
                                    await this.userInitService.initUser(
                                        result.user.id,
                                    );
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
}
