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
        ImporterModule,
        ConnectionsModule,
        LibrariesModule,
        NotificationsModule,
    ],
    providers: [ImporterWatchService],
    controllers: [ImporterWatchController],
})
export class ImporterWatchModule {}
