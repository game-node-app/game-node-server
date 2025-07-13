import { Module } from "@nestjs/common";
import { JournalService } from "./journal.service";
import { JournalController } from "./journal.controller";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";

/**
 * This modules exposed functionality related to the 'journal' feature, which is basically
 * a log of user's activities related to games.
 */
@Module({
    imports: [CollectionsEntriesModule],
    providers: [JournalService],
    controllers: [JournalController],
})
export class JournalModule {}
