import { Module } from "@nestjs/common";
import { UserInitService } from "./user-init.service";
import { LibrariesModule } from "../../libraries/libraries.module";
import { ProfileModule } from "../../profile/profile.module";
import { LevelModule } from "../../level/level.module";

@Module({
    exports: [UserInitService],
    imports: [LibrariesModule, ProfileModule, LevelModule],
    providers: [UserInitService],
})
export class UserInitModule {}
