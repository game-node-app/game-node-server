import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { PlayerConnectionSync } from "../sync/player-data/entity/player-connection-sync.entity";
import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { EConnectionAuthStatus } from "./connections.constants";
import { ConnectionsService } from "./connections.service";
import { UserConnectionDto } from "./dto/user-connection.dto";
import { OwnUserConnectionDto } from "./dto/own-user-connection.dto";

@Injectable()
export class ConnectionsSummaryService {
    private readonly logger = new Logger(ConnectionsSummaryService.name);

    constructor(
        @InjectRepository(CollectionEntry)
        private readonly entries: Repository<CollectionEntry>,
        @InjectRepository(PlayerConnectionSync)
        private readonly syncs: Repository<PlayerConnectionSync>,
        private readonly providers: ConnectionProviderRegistry,
        private readonly connections: ConnectionsService,
    ) {}

    async enrich(
        userId: string,
        connections: UserConnectionDto[],
    ): Promise<OwnUserConnectionDto[]> {
        if (!connections.length) return [];
        const [entries, states] = await Promise.all([
            this.entries.find({
                select: { gameId: true },
                where: { libraryUserId: userId },
            }),
            this.syncs.findBy({
                connectionId: In(
                    connections.map((connection) => connection.id),
                ),
            }),
        ]);
        const libraryIds = new Set(entries.map((entry) => entry.gameId));
        const statesById = new Map(
            states.map((state) => [state.connectionId, state]),
        );
        return Promise.all(
            connections.map(async (connection) => {
                const result: OwnUserConnectionDto = { ...connection };
                const state = statesById.get(connection.id);
                if (
                    state?.sourceUserId === connection.sourceUserId &&
                    state.stages?.discovery?.lastSucceededAt
                )
                    result.lastSyncedAt =
                        state.stages.discovery.lastSucceededAt;
                try {
                    const provider = this.providers.get(connection.type);
                    const handler = provider.syncHandlers?.fetchLibraryGames;
                    if (
                        !provider.isImporterViable ||
                        !handler ||
                        connection.authStatus ===
                            EConnectionAuthStatus.REAUTH_REQUIRED
                    )
                        return result;
                    const candidates = await handler(
                        userId,
                        false,
                        connection.sourceUserId,
                    );
                    const current =
                        await this.connections.findOneByUserIdAndType(
                            userId,
                            connection.type,
                        );
                    if (
                        !current ||
                        current.id !== connection.id ||
                        current.sourceUserId !== connection.sourceUserId
                    ) {
                        delete result.lastSyncedAt;
                        return result;
                    }
                    if (
                        current.authStatus ===
                        EConnectionAuthStatus.REAUTH_REQUIRED
                    )
                        return result;
                    result.unprocessedCount = new Set(
                        candidates
                            .filter(
                                (candidate) =>
                                    !libraryIds.has(candidate.gameId),
                            )
                            .map((candidate) => candidate.gameId),
                    ).size;
                } catch (error) {
                    this.logger.warn({
                        event: "connection-import-summary-unavailable",
                        source: connection.type,
                    });
                }
                return result;
            }),
        );
    }
}
