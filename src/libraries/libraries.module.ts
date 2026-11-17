import { Module } from "@nestjs/common";
import { LibrariesService } from "./libraries.service";
import { LibrariesController } from "./libraries.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Library } from "./entities/library.entity";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { LibraryAccessService } from "./library-access.service";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";

// TODO: Rename this module to the singular form
@Module({
    imports: [
        TypeOrmModule.forFeature([
            Library,
            Profile,
            UserFollow,
            CollectionEntry,
        ]),
    ],
    controllers: [LibrariesController],
    providers: [LibrariesService, LibraryAccessService],
    exports: [LibrariesService, LibraryAccessService],
})
export class LibrariesModule {}
