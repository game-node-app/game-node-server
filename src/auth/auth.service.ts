import { Inject, Injectable, Logger } from "@nestjs/common";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import Dashboard from "supertokens-node/recipe/dashboard";
import ThirdPartyPasswordless from "supertokens-node/recipe/thirdpartypasswordless";
import UserRoles from "supertokens-node/recipe/userroles";

import { ConfigInjectionToken, AuthModuleConfig } from "./config.interface";
import { CollectionsService } from "../collections/collections.service";
import { LibrariesService } from "../libraries/libraries.service";
import { DEFAULT_COLLECTIONS } from "../collections/collections.constants";
import { EUserRoles } from "../utils/constants";
import { ProfileService } from "../profile/profile.service";
import { UserInitService } from "../user-init/user-init.service";

/**
 * The Auth Service
 * uses SuperTokens to provide authentication
 */
@Injectable()
export class AuthService {
    private logger = new Logger(AuthService.name);

    constructor(
        @Inject(ConfigInjectionToken) private config: AuthModuleConfig,
        private userInitService: UserInitService,
    ) {
        supertokens.init({
            appInfo: config.appInfo,
            supertokens: {
                connectionURI: config.connectionURI,
                apiKey: config.apiKey,
            },
            recipeList: [
                ThirdPartyPasswordless.init({
                    flowType: "MAGIC_LINK",
                    contactMethod: "EMAIL",
                    providers: [
                        // We have provided you with development keys which you can use for testing.
                        // IMPORTANT: Please replace them with your own OAuth keys for production use.
                        ThirdPartyPasswordless.Google({
                            clientId:
                                "1060725074195-kmeum4crr01uirfl2op9kd5acmi9jutn.apps.googleusercontent.com",
                            clientSecret: "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",
                        }),
                        ThirdPartyPasswordless.Github({
                            clientId: "467101b197249757c71f",
                            clientSecret:
                                "e97051221f4b6426e8fe8d51486396703012f5bd",
                        }),
                        ThirdPartyPasswordless.Apple({
                            clientId: "4398792-io.supertokens.example.service",
                            clientSecret: {
                                keyId: "7M48Y4RYDL",
                                privateKey:
                                    "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgu8gXs+XYkqXD6Ala9Sf/iJXzhbwcoG5dMh1OonpdJUmgCgYIKoZIzj0DAQehRANCAASfrvlFbFCYqn3I2zeknYXLwtH30JuOKestDbSfZYxZNMqhF/OzdZFTV0zc5u5s3eN+oCWbnvl0hM+9IW0UlkdA\n-----END PRIVATE KEY-----",
                                teamId: "YWQCXGJRJL",
                            },
                        }),
                        // Facebook({
                        //     clientSecret: "FACEBOOK_CLIENT_SECRET",
                        //     clientId: "FACEBOOK_CLIENT_ID"
                        // })
                    ],
                    override: {
                        apis: (originalImplementation) => {
                            return {
                                ...originalImplementation,
                                thirdPartySignInUpPOST: async (input) => {
                                    if (
                                        originalImplementation.thirdPartySignInUpPOST ===
                                        undefined
                                    ) {
                                        throw Error(
                                            "thirdPartySignInUpPOST is undefined",
                                        );
                                    }
                                    const response =
                                        await originalImplementation.thirdPartySignInUpPOST(
                                            input,
                                        );
                                    if (response.status === "OK") {
                                        if (response.createdNewUser) {
                                            await this.userInitService.initUser(
                                                response.user.id,
                                            );
                                        }
                                    }

                                    return response;
                                },
                                consumeCodePOST: async (input) => {
                                    if (
                                        originalImplementation.consumeCodePOST ===
                                        undefined
                                    ) {
                                        throw Error(
                                            "consumeCodePOST is undefined",
                                        );
                                    }
                                    const response =
                                        await originalImplementation.consumeCodePOST(
                                            input,
                                        );
                                    if (response.status === "OK") {
                                        if (response.createdNewUser) {
                                            await this.userInitService.initUser(
                                                response.user.id,
                                            );
                                        }
                                    }

                                    return response;
                                },
                            };
                        },
                    },
                }),
                UserRoles.init(),
                Session.init(),
                Dashboard.init(),
            ],
        });
    }
}
