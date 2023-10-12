import { Module } from "@nestjs/common";
import { UserInitService } from "./user-init.service";
import { LibrariesModule } from "../../libraries/libraries.module";
import { CollectionsModule } from "../../collections/collections.module";
import { ProfileModule } from "../../profile/profile.module";

@Module({
    exports: [UserInitService],
    imports: [LibrariesModule, CollectionsModule, ProfileModule],
    providers: [UserInitService],
})
export class UserInitModule {}
