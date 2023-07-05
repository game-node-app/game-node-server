import {
    MiddlewareConsumer,
    Module,
    NestModule,
    DynamicModule,
} from "@nestjs/common";

import { AuthMiddleware } from "./auth.middleware";
import { ConfigInjectionToken, AuthModuleConfig } from "./config.interface";
import { AuthService } from "./auth.service";
import { LibrariesModule } from "../libraries/libraries.module";
import { CollectionsModule } from "../collections/collections.module";
import { AuthController } from './auth.controller';

@Module({
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
            imports: [LibrariesModule, CollectionsModule],
            module: AuthModule,
        };
    }
}
