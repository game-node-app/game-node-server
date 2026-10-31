import { Global, Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { UserInitModule } from "../user/user-init/user-init.module";

@Global()
@Module({
    imports: [UserInitModule],
    providers: [AuthService],
    exports: [AuthService],
})
export class AuthModule {}
