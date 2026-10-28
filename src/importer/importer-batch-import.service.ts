import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { runOnTransactionCommit, Transactional } from "typeorm-transactional";
import { In } from "typeorm";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { Collection } from "../collections/entities/collection.entity";
import { UserConnection } from "../connection/entity/user-connection.entity";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "../connection/connections.constants";
import { UserConnectionDto } from "../connection/dto/user-connection.dto";
import { ImporterProcessedEntry } from "./entity/importer-processed-entry.entity";
import { ImporterIgnoredEntry } from "./entity/importer-ignored-entry.entity";
import { ImporterResponseItemDto } from "./dto/importer-response-item.dto";
import { ImporterBatchImportRequestDto } from "./dto/importer-batch-import-request.dto";
import { EImporterSource } from "./importer.constants";
import { ImporterService } from "./importer.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import { ImporterBatchEffect } from "./entity/importer-batch-effect.entity";
import { ImporterBatchEffectsService } from "./importer-batch-effects.service";

@Injectable()
export class ImporterBatchImportService {
    private readonly logger = new Logger(ImporterBatchImportService.name);

    constructor(
        private readonly importer: ImporterService,
        private readonly collectionsEntries: CollectionsEntriesService,
        private readonly effects: ImporterBatchEffectsService,
        @InjectRepository(ImporterProcessedEntry)
        private readonly processed: Repository<ImporterProcessedEntry>,
        @InjectRepository(ImporterIgnoredEntry)
        private readonly ignored: Repository<ImporterIgnoredEntry>,
    ) {}

    async import(
        userId: string,
        source: EImporterSource,
        dto: ImporterBatchImportRequestDto,
    ) {
        const snapshot = await this.importer.findProviderSnapshot(
            userId,
            source,
        );
        const marked = await this.importer.getProcessedEntries(userId);
        const markedIds = new Set(
            marked.map((entry) => String(entry.gameExternalGameId)),
        );
        const visible = [
            ...new Map(
                snapshot.candidates.map((candidate) => [
                    candidate.uid,
                    candidate,
                ]),
            ).values(),
        ].filter((candidate) => !markedIds.has(String(candidate.id)));
        const visibleGames = new Set(
            visible.map((candidate) => candidate.gameId),
        );
        const selected = dto.importAll
            ? snapshot.candidates.filter(
                  (candidate) =>
                      visibleGames.has(candidate.gameId) &&
                      !markedIds.has(String(candidate.id)),
              )
            : this.importer.validateCandidateIds(
                  snapshot.candidates,
                  dto.externalGameIds!,
              );
        if (selected.some((candidate) => markedIds.has(String(candidate.id))))
            throw new HttpException(
                "Candidate has already been processed",
                HttpStatus.CONFLICT,
            );
        if (selected.some((candidate) => !visibleGames.has(candidate.gameId)))
            throw new HttpException(
                "Invalid importer candidate",
                HttpStatus.BAD_REQUEST,
            );
        const uniqueById = [
            ...new Map(
                selected.map((candidate) => [String(candidate.id), candidate]),
            ).values(),
        ];
        const collectionIds = [...new Set(dto.collectionIds ?? [])];
        const selectedGames = new Set(
            uniqueById.map((candidate) => candidate.gameId),
        );
        const visibleIds = visible
            .filter((candidate) => selectedGames.has(candidate.gameId))
            .map((candidate) => candidate.id);
        const result = await this.commit(
            userId,
            snapshot.connection,
            uniqueById,
            visibleIds,
            dto.status ?? CollectionEntryStatus.PLANNED,
            collectionIds,
        );
        return {
            importedCount: result.entryIds.length,
            skippedCount: result.skippedCount,
        };
    }

    @Transactional()
    private async commit(
        userId: string,
        snapshot: UserConnectionDto,
        candidates: ImporterResponseItemDto[],
        visibleIds: number[],
        status: CollectionEntryStatus,
        collectionIds: string[],
    ) {
        const manager = this.processed.manager;
        const connection = await manager.getRepository(UserConnection).findOne({
            where: {
                id: snapshot.id,
                profileUserId: userId,
                type: snapshot.type as EConnectionType,
            },
            lock: { mode: "pessimistic_write" },
        });
        if (
            !connection ||
            connection.sourceUserId !== snapshot.sourceUserId ||
            connection.authStatus === EConnectionAuthStatus.REAUTH_REQUIRED
        )
            throw new HttpException(
                "Connection changed during import",
                HttpStatus.CONFLICT,
            );
        await this.importer.lockLibrary(userId);
        if (collectionIds.length) {
            const collections = await manager.getRepository(Collection).find({
                where: { id: In(collectionIds), libraryUserId: userId },
                lock: { mode: "pessimistic_write" },
            });
            if (collections.length !== collectionIds.length)
                throw new HttpException(
                    "Collection not found or does not belong to user",
                    HttpStatus.BAD_REQUEST,
                );
        }
        if (candidates.length) {
            const where = {
                libraryUserId: userId,
                gameExternalGameId: In([
                    ...new Set([
                        ...candidates.map((candidate) => candidate.id),
                        ...visibleIds,
                    ]),
                ]),
            };
            const [processed, ignored] = await Promise.all([
                this.processed.findBy(where),
                this.ignored.findBy(where),
            ]);
            if (processed.length || ignored.length)
                throw new HttpException(
                    "Candidate has already been processed",
                    HttpStatus.CONFLICT,
                );
        }
        const games = [
            ...new Map(
                candidates.map((candidate) => [candidate.gameId, candidate]),
            ).values(),
        ];
        const created = await this.collectionsEntries.createMissingForBatch(
            userId,
            games,
            status,
            collectionIds,
        );
        const markers = candidates.map((candidate) => ({
            libraryUserId: userId,
            gameExternalGameId: candidate.id,
        }));
        for (let offset = 0; offset < markers.length; offset += 500)
            await this.processed.insert(markers.slice(offset, offset + 500));
        if (created.length) {
            await manager.getRepository(ImporterBatchEffect).insert({
                id: randomUUID(),
                libraryUserId: userId,
                entryIds: created.map((entry) => entry.id),
                collectionIds,
            });
            runOnTransactionCommit(() => {
                this.effects
                    .recover()
                    .catch((error) =>
                        this.logger.error(
                            "Unable to publish batch import effects",
                            error,
                        ),
                    );
            });
        }
        return {
            entryIds: created.map((entry) => entry.id),
            skippedCount: games.length - created.length,
        };
    }
}
