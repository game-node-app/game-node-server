import { TypeOrmModule } from "@nestjs/typeorm";
import { LinkedProvider } from "./entity/linked-provider.entity";
import { Module } from "@nestjs/common";
import { UserAccountController } from "./user-account.controller";
import { UserAccountService } from "./user-account.service";
import { LibrariesModule } from "../../libraries/libraries.module";
import { ProfileModule } from "../../profile/profile.module";

@Module({
    imports: [LibrariesModule, ProfileModule, TypeOrmModule.forFeature([LinkedProvider])],
    controllers: [UserAccountController],
    providers: [UserAccountService],
    exports: [UserAccountService],
})
export class UserAccountModule {}
