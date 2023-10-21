import { Module } from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CollectionsController } from "./collections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { LibrariesModule } from "../libraries/libraries.module";
import { ReviewsModule } from "../reviews/reviews.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Collection]),
        LibrariesModule,
        ReviewsModule,
    ],
    controllers: [CollectionsController],
    providers: [CollectionsService],
    exports: [CollectionsService],
})
export class CollectionsModule {}
