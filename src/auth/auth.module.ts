import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { AuthMiddleware } from "./auth.middleware";
import { AuthService } from "./auth.service";
import { UserInitModule } from "../user/user-init/user-init.module";

@Module({
    imports: [UserInitModule],
    providers: [AuthService],
})
export class AuthModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).forRoutes("*");
    }
}
