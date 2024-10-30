import { forwardRef, Module } from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CollectionsController } from "./collections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { LibrariesModule } from "../libraries/libraries.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { CollectionsEntriesModule } from "./collections-entries/collections-entries.module";
import { AchievementsModule } from "../achievements/achievements.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Collection]),
        LibrariesModule,
        forwardRef(() => CollectionsEntriesModule),
        AchievementsModule,
    ],
    controllers: [CollectionsController],
    providers: [CollectionsService],
    exports: [CollectionsService],
})
export class CollectionsModule {}
