import { Module } from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CollectionsController } from "./collections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { CollectionEntry } from "./entities/collectionEntry.entity";
import { LibrariesModule } from "../libraries/libraries.module";
import { IgdbModule } from "../igdb/igdb.module";
import { CollectionsEntriesService } from './collections-entries/collections-entries.service';
import { CollectionsEntriesController } from './collections-entries/collections-entries.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([Collection, CollectionEntry]),
        LibrariesModule,
        IgdbModule,
    ],
    controllers: [CollectionsController, CollectionsEntriesController],
    providers: [CollectionsService, CollectionsEntriesService],
    exports: [CollectionsService],
})
export class CollectionsModule {}
