import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { PlayerConnectionSync } from "../sync/player-data/entity/player-connection-sync.entity";
import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { EConnectionAuthStatus } from "./connections.constants";
import { UserConnectionDto } from "./dto/user-connection.dto";
import { OwnUserConnectionDto } from "./dto/own-user-connection.dto";
import { ImporterProcessedEntry } from "../importer/entity/importer-processed-entry.entity";
import { ImporterIgnoredEntry } from "../importer/entity/importer-ignored-entry.entity";

/**
 * Adds each connection's last sync time and unimported game count. The count comes from the games the last
 * discovery stored, minus those imported or ignored since; no store is called here.
 */
@Injectable()
export class ConnectionsSummaryService {
    constructor(
        @InjectRepository(CollectionEntry)
        private readonly entries: Repository<CollectionEntry>,
        @InjectRepository(PlayerConnectionSync)
        private readonly syncs: Repository<PlayerConnectionSync>,
        @InjectRepository(ImporterProcessedEntry)
        private readonly processed: Repository<ImporterProcessedEntry>,
        @InjectRepository(ImporterIgnoredEntry)
        private readonly ignored: Repository<ImporterIgnoredEntry>,
        private readonly providers: ConnectionProviderRegistry,
    ) {}

    async enrich(
        userId: string,
        connections: UserConnectionDto[],
    ): Promise<OwnUserConnectionDto[]> {
        if (!connections.length) return [];
        const marked = {
            select: { gameExternalGameId: true },
            where: { libraryUserId: userId },
        };
        const [entries, states, processed, ignored] = await Promise.all([
            this.entries.find({
                select: { gameId: true },
                where: { libraryUserId: userId },
            }),
            this.syncs.findBy({
                connectionId: In(
                    connections.map((connection) => connection.id),
                ),
            }),
            this.processed.find(marked),
            this.ignored.find(marked),
        ]);
        const libraryIds = new Set(entries.map((entry) => entry.gameId));
        const markedIds = new Set(
            [...processed, ...ignored].map((entry) => entry.gameExternalGameId),
        );
        const statesById = new Map(
            states.map((state) => [state.connectionId, state]),
        );
        return connections.map((connection) => {
            const result: OwnUserConnectionDto = { ...connection };
            const state = statesById.get(connection.id);
            // A state left by a previous account of this connection says nothing about the current one.
            if (state?.sourceUserId !== connection.sourceUserId) return result;
            if (state.stages?.discovery?.lastSucceededAt)
                result.lastSyncedAt = state.stages.discovery.lastSucceededAt;
            if (
                !state.libraryCandidates ||
                !this.providers.has(connection.type) ||
                !this.providers.get(connection.type).isImporterViable ||
                connection.authStatus === EConnectionAuthStatus.REAUTH_REQUIRED
            )
                return result;
            result.unprocessedCount = new Set(
                state.libraryCandidates
                    .filter(
                        (candidate) =>
                            !libraryIds.has(candidate.gameId) &&
                            !markedIds.has(candidate.id),
                    )
                    .map((candidate) => candidate.gameId),
            ).size;
            return result;
        });
    }
}
