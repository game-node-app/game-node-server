import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ImporterNotifiedEntry } from "../entity/importer-notified-entry.entity";
import { Repository } from "typeorm";
import { ImporterService } from "../importer.service";
import { Interval } from "@nestjs/schedule";
import { hours } from "@nestjs/throttler";
import { ConnectionsService } from "../../connections/connections.service";
import { LibrariesService } from "../../libraries/libraries.service";
import { UserConnection } from "../../connections/entity/user-connection.entity";

@Injectable()
export class ImporterWatchService {
    constructor(
        @InjectRepository(ImporterNotifiedEntry)
        private readonly importerNotifiedEntryRepository: Repository<ImporterNotifiedEntry>,
        private readonly importerService: ImporterService,
        private readonly connectionsService: ConnectionsService,
        private readonly librariesService: LibrariesService,
    ) {}

    /**
     * Checks for new importable entries from users with connections
     */
    @Interval(hours(6))
    async process() {
        const libraries = await this.librariesService.findAllLibraries();
        const userIds = libraries.map((library) => library.userId);
        const connections =
            await this.connectionsService.findAllByUserIdIn(userIds);

        const usableConnections = connections.filter(
            (connection) =>
                connection.isImporterViable && connection.isImporterEnabled,
        );

        for (const connection of usableConnections) {
        }
    }

    private async findUnprocessedEntries(userConnection: UserConnection) {}
}
