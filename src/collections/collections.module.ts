import { Module } from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CollectionsController } from "./collections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { CollectionEntry } from "./entities/collectionEntry.entity";
import { LibrariesModule } from "../libraries/libraries.module";
import { IgdbModule } from "../igdb/igdb.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Collection, CollectionEntry]),
        LibrariesModule,
        IgdbModule,
    ],
    controllers: [CollectionsController],
    providers: [CollectionsService],
    exports: [CollectionsService],
})
export class CollectionsModule {}
