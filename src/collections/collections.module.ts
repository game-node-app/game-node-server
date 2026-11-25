import { forwardRef, Module } from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CollectionsController } from "./collections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { ReviewsModule } from "../reviews/reviews.module";
import { CollectionsEntriesModule } from "./collections-entries/collections-entries.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BillingModule } from "../billing/billing.module";
import { LibrariesModule } from "../libraries/libraries.module";
import { GuildQueueModule } from "../guild/guild-queue/guild-queue.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Collection]),
        forwardRef(() => CollectionsEntriesModule),
        NotificationsModule,
        BillingModule,
        LibrariesModule,
        GuildQueueModule,
    ],
    controllers: [CollectionsController],
    providers: [CollectionsService],
    exports: [CollectionsService],
})
export class CollectionsModule {}
