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
                    flowType: "MAGIC_LINK",
                    contactMethod: "EMAIL",
                }),
                UserRoles.init(),
                Session.init(),
                Dashboard.init(),
            ],
        });
    }
}
