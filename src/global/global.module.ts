import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EMAIL_CONFIG_TOKEN } from "./global.tokens";
import { SMTPServiceConfig } from "supertokens-node/lib/build/ingredients/emaildelivery/services/smtp";

@Global()
@Module({
    providers: [
        // Add global providers here
        {
            provide: EMAIL_CONFIG_TOKEN,
            useFactory: (configService: ConfigService) => {
                return {
                    from: {
                        name: "GameNode",
                        email: configService.get("EMAIL_FROM")!,
                    },
                    host: configService.get("EMAIL_HOST")!,
                    port: configService.get("EMAIL_PORT")
                        ? parseInt(configService.get("EMAIL_PORT")!)
                        : 465,
                    secure: true,
                    password: configService.get("EMAIL_PASSWORD")!,
                    authUsername: configService.get("EMAIL_USERNAME"),
                } satisfies SMTPServiceConfig;
            },
            inject: [ConfigService],
        },
    ],
    exports: [EMAIL_CONFIG_TOKEN],
})
export class GlobalModule {}
