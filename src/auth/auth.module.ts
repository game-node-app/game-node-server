import {
    MiddlewareConsumer,
    Module,
    NestModule,
    DynamicModule,
} from "@nestjs/common";

import { AuthMiddleware } from "./auth.middleware";
import { ConfigInjectionToken, AuthModuleConfig } from "./config.interface";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { UserInitModule } from "../user-init/user-init.module";

@Module({
    imports: [UserInitModule],
    providers: [],
    exports: [],
    controllers: [AuthController],
})
export class AuthModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).forRoutes();
    }

    static forRoot({
        connectionURI,
        apiKey,
        appInfo,
    }: AuthModuleConfig): DynamicModule {
        return {
            providers: [
                {
                    useValue: {
                        appInfo,
                        connectionURI,
                        apiKey,
                    },
                    provide: ConfigInjectionToken,
                },
                AuthService,
            ],
            exports: [],
            imports: [UserInitModule],
            module: AuthModule,
        };
    }
}
