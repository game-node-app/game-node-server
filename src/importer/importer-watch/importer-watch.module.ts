import { Module } from "@nestjs/common";
import { ImporterWatchService } from "./importer-watch.service";
import { ConnectionsModule } from "../../connections/connections.module";
import { ImporterModule } from "../importer.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ImporterNotifiedEntry } from "../entity/importer-notified-entry.entity";
import { LibrariesModule } from "../../libraries/libraries.module";
import { NotificationsModule } from "../../notifications/notifications.module";
import { ImporterWatchNotification } from "../entity/importer-notification.entity";
import { ImporterWatchController } from "./importer-watch.controller";
import { BullModule } from "@nestjs/bullmq";
import { IMPORTER_WATCH_QUEUE_NAME } from "./importer-watch.constants";
import { ImporterWatchProcessor } from "./importer-watch.processor";

/**
 * Module of the Importer Watch Service, which is responsible for querying user's
 * available connections, and checking if any new entries are available
 * for importing, notifying them.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            ImporterNotifiedEntry,
            ImporterWatchNotification,
        ]),
        BullModule.registerQueue({
            name: IMPORTER_WATCH_QUEUE_NAME,
            defaultJobOptions: {
                removeOnFail: true,
                removeOnComplete: true,
                attempts: 1,
            },
        }),
        ImporterModule,
        ConnectionsModule,
        LibrariesModule,
        NotificationsModule,
    ],
    providers: [ImporterWatchService, ImporterWatchProcessor],
    controllers: [ImporterWatchController],
})
export class ImporterWatchModule {}
