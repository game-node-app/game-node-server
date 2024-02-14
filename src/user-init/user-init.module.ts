import { Module } from "@nestjs/common";
import { UserInitService } from "./user-init.service";
import { LibrariesModule } from "../libraries/libraries.module";
import { CollectionsModule } from "../collections/collections.module";
import { ProfileModule } from "../profile/profile.module";
import { UserLevelModule } from "../user-level/user-level.module";

@Module({
    exports: [UserInitService],
    imports: [
        LibrariesModule,
        CollectionsModule,
        ProfileModule,
        UserLevelModule,
    ],
    providers: [UserInitService],
})
export class UserInitModule {}
