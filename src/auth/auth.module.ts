import { Global, Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { UserInitModule } from "../user/user-init/user-init.module";
import { BillingModule } from "../billing/billing.module";

@Global()
@Module({
    imports: [UserInitModule, BillingModule],
    providers: [AuthService],
    exports: [AuthService],
})
export class AuthModule {}
