import { Module } from "@nestjs/common";
import { UserAccountController } from "./user-account.controller";
import { UserAccountService } from "./user-account.service";
import { LibrariesModule } from "../../libraries/libraries.module";
import { ProfileModule } from "../../profile/profile.module";

@Module({
    imports: [LibrariesModule, ProfileModule],
    controllers: [UserAccountController],
    providers: [UserAccountService],
})
export class UserAccountModule {}
