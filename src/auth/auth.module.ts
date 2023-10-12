import {
    MiddlewareConsumer,
    Module,
    NestModule,
    DynamicModule,
} from "@nestjs/common";

import { AuthMiddleware } from "./auth.middleware";
import {
    SupertokensConfigInjectionToken,
    AuthModuleConfig,
} from "./config.interface";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { UserInitModule } from "./user-init/user-init.module";
import * as process from "process";

@Module({
    imports: [UserInitModule],
    providers: [],
    exports: [],
    controllers: [AuthController],
})
export class AuthModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).forRoutes("*");
    }

    static forRoot({
        connectionURI,
        apiKey,
        appInfo,
    }: AuthModuleConfig): DynamicModule {
        for (const value of Object.values(appInfo)) {
            if (!value) {
                throw new Error(
                    "App info is missing. Please provide all required fields.",
                );
            }
        }
        return {
            providers: [
                {
                    useValue: {
                        appInfo,
                        connectionURI,
                        apiKey,
                    },
                    provide: SupertokensConfigInjectionToken,
                },
                AuthService,
            ],
            exports: [],
            imports: [UserInitModule],
            module: AuthModule,
        };
    }
}
