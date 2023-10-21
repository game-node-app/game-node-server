import { Global, Module } from "@nestjs/common";
import * as process from "process";
import { SupertokensConfigInjectionToken } from "../auth/config.interface";
import { ConfigModule } from "@nestjs/config";

@Global()
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
    ],
    providers: [
        // Add global providers here
        {
            useValue: {
                appInfo: {
                    // Learn more about this on https://supertokens.com/docs/thirdparty/appinfo
                    appName: "GameNode",
                    apiDomain: process.env.DOMAIN_API as any,
                    websiteDomain: process.env.DOMAIN_WEBSITE as any,
                    apiBasePath: "/v1/auth",
                    websiteBasePath: "/auth",
                },
                connectionURI: process.env.SUPERTOKENS_CORE_URI as string,
                apiKey: undefined,
            },
            provide: SupertokensConfigInjectionToken,
        },
    ],
    exports: [SupertokensConfigInjectionToken],
})
export class GlobalModule {}
