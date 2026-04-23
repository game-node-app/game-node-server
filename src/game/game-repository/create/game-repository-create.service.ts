import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
    DataSource,
    DeepPartial,
    FindOptionsRelations,
    FindOptionsSelect,
    Repository,
} from "typeorm";
import { Game } from "../entities/game.entity";
import { GameCompany } from "../entities/game-company.entity";
import { GameCompanyLogo } from "../entities/game-company-logo.entity";
import { GameEngine } from "../entities/game-engine.entity";
import { StatisticsQueueService } from "../../../statistics/statistics-queue/statistics-queue.service";
import { IGDBPartialGame } from "../game-repository.types";
import { StatisticsSourceType } from "../../../statistics/statistics.constants";
import {
    hasChecksumChanged,
    ObjectWithChecksum,
} from "./game-repository-create.utils";
import { GamePlatform } from "../entities/game-platform.entity";
import { ArrayKeys, NonArrayKeys } from "../../../utils/arrayKeys";
import { GamePropertyPathToEntityMap } from "./game-repository-create.constants";

const ONE_WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Service responsible for data inserting and updating for all game-related models.
 * PS: Only make changes to this service if you are sure it won't break the sync process.
 */
@Injectable()
export class GameRepositoryCreateService {
    private readonly logger = new Logger(GameRepositoryCreateService.name);
    private readonly shouldProfileSync: boolean;
    private readonly shouldSkipRelationsOnChecksumMatch: boolean;
    private readonly reconcileEveryRuns: number;

    /**
     * Good luck unit-testing this btw
     * @param gameRepository
     * @param statisticsQueueService
     * @param dataSource
     */
    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        private readonly statisticsQueueService: StatisticsQueueService,
        private readonly dataSource: DataSource,
        private readonly configService: ConfigService,
    ) {
        this.shouldProfileSync =
            this.configService.get<string>(
                "IGDB_SYNC_PROFILE_HOT_PATH",
                "false",
            ) === "true";
        this.shouldSkipRelationsOnChecksumMatch =
            this.configService.get<string>(
                "IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH",
                "true",
            ) !== "false";
        this.reconcileEveryRuns = this.parsePositiveInteger(
            this.configService.get<string>(
                "IGDB_SYNC_RECONCILE_EVERY_RUNS",
                "4",
            ),
            4,
        );
    }

    async isValidEntry(game: IGDBPartialGame) {
        if (game.id == null || typeof game.id !== "number") {
            return false;
        } else if (
            game.name == undefined &&
            (game.alternativeNames == undefined ||
                game.alternativeNames.length === 0)
        ) {
            return false;
        }

        return true;
    }

    /**
     * Creates or updates a game in our database. <br>
     * ManyToMany models can't be easily upserted, since the junction table is not inserted/updated automatically (without .save).
     * To both fix this and circumvent the .save() bug, use the QueryBuilder with the .relation() method.
     * Bug info: https://github.com/typeorm/typeorm/issues/1754
     * @param game
     */
    async createOrUpdate(game: IGDBPartialGame) {
        const startedAt = this.getProfilingStart();
        const shouldProcess = await this.isValidEntry(game);

        if (!shouldProcess) {
            this.logProfilingDuration("createOrUpdate:invalid", startedAt);
        }

        const existing = await this.gameRepository.findOne({
            where: { id: game.id },
            select: { id: true, checksum: true },
        });

        this.handleDeprecatedFields(game);

        const checksumHasChanged =
            existing == undefined || existing.checksum !== game.checksum;

        if (checksumHasChanged) {
            this.logger.log(`Upserting game ${game.id} - ${game.name}`);
            await this.gameRepository.upsert(game, ["id"]);
        }

        const shouldReconcileRelations =
            checksumHasChanged || this.shouldReconcileRelationsForGame(game.id);

        if (shouldReconcileRelations) {
            this.logger.log(
                `Processing relationships for game ${game.id} - ${game.name}`,
            );
            await this.processRelationships(game);
        } else {
            this.logger.log(
                `Skipping relationship processing for game ${game.id} - ${game.name} due to checksum match and reconciliation settings`,
            );
        }

        const isUpdateAction = existing != undefined;
        this.dispatchCreateUpdateEvent(game, isUpdateAction);
        this.logProfilingDuration("createOrUpdate", startedAt, {
            gameId: game.id,
            checksumHasChanged,
            shouldReconcileRelations,
        });
    }

    private dispatchCreateUpdateEvent(
        game: IGDBPartialGame,
        isUpdateAction: boolean,
    ) {
        if (!isUpdateAction) {
            this.statisticsQueueService.createStatistics({
                sourceId: game.id,
                sourceType: StatisticsSourceType.GAME,
            });
        }
    }

    private async processRelationships(incoming: IGDBPartialGame) {
        const startedAt = this.getProfilingStart();
        const processCover = incoming.cover !== undefined;
        const processAlternativeNames = incoming.alternativeNames !== undefined;
        const processArtworks = incoming.artworks !== undefined;
        const processScreenshots = incoming.screenshots !== undefined;
        const processLocalizations = incoming.gameLocalizations !== undefined;
        const processFranchises = incoming.franchises !== undefined;
        const processPlatforms = incoming.platforms !== undefined;
        const processKeywords = incoming.keywords !== undefined;
        const processGenres = incoming.genres !== undefined;
        const processDlcs = incoming.dlcs !== undefined;
        const processExpansions = incoming.expansions !== undefined;
        const processExpandedGames = incoming.expandedGames !== undefined;
        const processSimilarGames = incoming.similarGames !== undefined;
        const processThemes = incoming.themes !== undefined;
        const processGameModes = incoming.gameModes !== undefined;
        const processPlayerPerspectives =
            incoming.playerPerspectives !== undefined;
        const processExternalGames = incoming.externalGames !== undefined;
        const processInvolvedCompanies =
            incoming.involvedCompanies !== undefined;
        const processGameEngines = incoming.gameEngines !== undefined;

        const relations: FindOptionsRelations<Game> = {};
        const select: FindOptionsSelect<Game> = {
            id: true,
        };

        if (processCover) {
            relations.cover = true;
            select.cover = { id: true, checksum: true };
        }
        if (processAlternativeNames) {
            relations.alternativeNames = true;
            select.alternativeNames = { id: true, checksum: true };
        }
        if (processArtworks) {
            relations.artworks = true;
            select.artworks = { id: true, checksum: true };
        }
        if (processScreenshots) {
            relations.screenshots = true;
            select.screenshots = { id: true, checksum: true };
        }
        if (processLocalizations) {
            relations.gameLocalizations = true;
            select.gameLocalizations = { id: true, checksum: true };
        }
        if (processFranchises) {
            relations.franchises = true;
            select.franchises = { id: true, checksum: true };
        }
        if (processPlatforms) {
            relations.platforms = true;
            select.platforms = { id: true, checksum: true };
        }
        if (processKeywords) {
            relations.keywords = true;
            select.keywords = { id: true, checksum: true };
        }
        if (processGenres) {
            relations.genres = true;
            select.genres = { id: true, checksum: true };
        }
        if (processDlcs) {
            relations.dlcs = true;
            select.dlcs = { id: true, checksum: true };
        }
        if (processExpansions) {
            relations.expansions = true;
            select.expansions = { id: true, checksum: true };
        }
        if (processExpandedGames) {
            relations.expandedGames = true;
            select.expandedGames = { id: true, checksum: true };
        }
        if (processSimilarGames) {
            relations.similarGames = true;
            select.similarGames = { id: true, checksum: true };
        }
        if (processThemes) {
            relations.themes = true;
            select.themes = { id: true, checksum: true };
        }
        if (processGameModes) {
            relations.gameModes = true;
            select.gameModes = { id: true, checksum: true };
        }
        if (processPlayerPerspectives) {
            relations.playerPerspectives = true;
            select.playerPerspectives = { id: true, checksum: true };
        }
        if (processExternalGames) {
            relations.externalGames = true;
            select.externalGames = { id: true, checksum: true };
        }
        if (processInvolvedCompanies) {
            relations.involvedCompanies = {
                company: {
                    logo: true,
                },
            };
            select.involvedCompanies = {
                id: true,
                checksum: true,
                company: {
                    id: true,
                    checksum: true,
                    logo: {
                        id: true,
                        checksum: true,
                    },
                },
            };
        }
        if (processGameEngines) {
            relations.gameEngines = {
                companies: {
                    logo: true,
                },
                platforms: true,
            };
            select.gameEngines = {
                id: true,
                checksum: true,
                companies: {
                    id: true,
                    checksum: true,
                    logo: {
                        id: true,
                        checksum: true,
                    },
                },
                platforms: {
                    id: true,
                    checksum: true,
                },
            };
        }

        const existing = await this.gameRepository.findOneOrFail({
            where: { id: incoming.id },
            relations,
            select,
            relationLoadStrategy: "query",
        });

        const relationsPromises: Promise<void>[] = [];
        if (processCover) {
            relationsPromises.push(
                this.handleOneToOne(incoming, existing, "cover"),
            );
        }
        if (processAlternativeNames) {
            relationsPromises.push(
                this.handleOneToMany(incoming, existing, "alternativeNames"),
            );
        }
        if (processArtworks) {
            relationsPromises.push(
                this.handleOneToMany(incoming, existing, "artworks"),
            );
        }
        if (processScreenshots) {
            relationsPromises.push(
                this.handleOneToMany(incoming, existing, "screenshots"),
            );
        }
        if (processLocalizations) {
            relationsPromises.push(
                this.handleOneToMany(incoming, existing, "gameLocalizations"),
            );
        }
        if (processFranchises) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "franchises"),
            );
        }
        if (processPlatforms) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "platforms"),
            );
        }
        if (processKeywords) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "keywords"),
            );
        }
        if (processGenres) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "genres"),
            );
        }
        if (processDlcs) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "dlcs"),
            );
        }
        if (processExpansions) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "expansions"),
            );
        }
        if (processExpandedGames) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "expandedGames"),
            );
        }
        if (processSimilarGames) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "similarGames"),
            );
        }
        if (processThemes) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "themes"),
            );
        }
        if (processGameModes) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "gameModes"),
            );
        }
        if (processPlayerPerspectives) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "playerPerspectives"),
            );
        }
        if (processExternalGames) {
            relationsPromises.push(
                this.handleManyToMany(incoming, existing, "externalGames"),
            );
        }

        await Promise.all(relationsPromises);

        await this.handleDeepNestedEntities(incoming, existing);
        this.logProfilingDuration("processRelationships", startedAt, {
            gameId: incoming.id,
            directRelationHandlers: relationsPromises.length,
        });
    }

    async handleManyToMany<
        K extends ArrayKeys<Game>,
        V extends Game[K],
        E extends V extends Array<infer U extends ObjectWithChecksum>
            ? U
            : never,
    >(incoming: IGDBPartialGame, existing: Game, propertyPath: K) {
        const target = GamePropertyPathToEntityMap[propertyPath]!;
        const repository = this.dataSource.getRepository(target);
        const gameEntityMetadata = this.dataSource.getMetadata(Game);
        const incomingData = incoming[propertyPath] as E[] | undefined;
        const existingData = existing[propertyPath] as E[];

        if (incomingData == undefined) {
            return;
        }
        if (!hasChecksumChanged(incomingData, existingData)) {
            return;
        }

        const incomingParsed = incomingData.map((item) =>
            repository.create({ ...item, game: existing, gameId: existing.id }),
        );

        const existingIds = new Set(existingData.map((item) => item.id));
        const incomingIds = new Set(incomingData.map((item) => item.id));
        const existingNotInIncoming = existingData.filter(
            (item) => !incomingIds.has(item.id),
        );
        const incomingNotInExisting = incomingData.filter(
            (item) => !existingIds.has(item.id),
        );

        const isSelfReferencing =
            repository.target === gameEntityMetadata.target;
        /**
         * Only performs upsert if entity is not self referencing (Game to Game relations).
         */
        if (!isSelfReferencing) {
            this.logger.log(
                `Upserting ${incomingParsed.length} items for ${String(propertyPath)}`,
            );
            await repository.upsert(incomingParsed, ["id"]);
        }

        if (
            incomingNotInExisting.length === 0 &&
            existingNotInIncoming.length === 0
        ) {
            return;
        }

        this.logger.log(
            `Updating relations for ${String(propertyPath)} - Adding: ${incomingNotInExisting.length}, Removing: ${existingNotInIncoming.length}`,
        );
        await repository
            .createQueryBuilder()
            .relation(Game, propertyPath)
            .of(existing)
            // Updates the junction table with new/removed associations
            .addAndRemove(incomingNotInExisting, existingNotInIncoming);
    }

    async handleOneToMany<
        K extends ArrayKeys<Game>,
        V extends Game[K],
        E extends V extends Array<infer U extends ObjectWithChecksum>
            ? U
            : never,
    >(incoming: IGDBPartialGame, existing: Game, propertyPath: K) {
        const repository = this.dataSource.getRepository(
            GamePropertyPathToEntityMap[propertyPath]!,
        );
        const incomingData = incoming[propertyPath] as E[] | undefined;
        const existingData = existing[propertyPath] as unknown as E[];

        if (incomingData == undefined) {
            return;
        }
        if (!hasChecksumChanged(incomingData, existingData)) {
            return;
        }

        const incomingParsed = incomingData.map((item) =>
            repository.create({ ...item, game: existing, gameId: existing.id }),
        );

        this.logger.log(
            `Upserting ${incomingParsed.length} items for ${String(propertyPath)}`,
        );
        await repository.upsert(incomingParsed, ["id"]);
    }

    async handleOneToOne<
        K extends NonArrayKeys<Game>,
        V extends Game[K],
        E extends V extends ObjectWithChecksum ? V : never,
    >(incoming: IGDBPartialGame, existing: Game, propertyPath: K) {
        const repository = this.dataSource.getRepository(
            GamePropertyPathToEntityMap[propertyPath]!,
        );
        const incomingData = incoming[propertyPath] as E | undefined;
        const existingData = existing[propertyPath] as E | undefined;

        if (incomingData == undefined || typeof incomingData !== "object") {
            return;
        }

        if (
            existingData &&
            incomingData.id === existingData.id &&
            incomingData.checksum === existingData.checksum
        ) {
            return;
        }

        const incomingParsed = repository.create({
            ...incomingData,
            game: existing,
            gameId: existing.id,
        });

        this.logger.log(`Upserting item for ${String(propertyPath)}`);

        await repository.upsert(incomingParsed, ["id"]);
        await repository
            .createQueryBuilder()
            .relation(Game, propertyPath)
            .of(existing)
            .set(incomingParsed);
    }

    async handleCompanies(incoming: IGDBPartialGame, existing: Game) {
        const companies = (incoming.involvedCompanies ?? []).map(
            (involvedCompany) => involvedCompany.company,
        );
        companies.push(
            ...(incoming.gameEngines ?? []).flatMap((ge) => ge.companies),
        );

        if (companies.length === 0) return;

        const existingCompanies: GameCompany[] = [
            ...(existing.involvedCompanies ?? []).flatMap((ic) => ic.company),
            ...(existing.gameEngines ?? []).flatMap((ge) => ge.companies),
        ];

        const validCompanies = companies.filter(
            (company): company is DeepPartial<GameCompany> =>
                company != undefined,
        );
        const existingCompanyChecksums = new Set(
            existingCompanies
                .map((company) => company.checksum)
                .filter(
                    (checksum): checksum is string => checksum != undefined,
                ),
        );
        const existingLogos = existingCompanies
            .map((company) => company.logo)
            .filter(Boolean) as GameCompanyLogo[];
        const existingLogoChecksums = new Set(
            existingLogos
                .map((logo) => logo.checksum)
                .filter(
                    (checksum): checksum is string => checksum != undefined,
                ),
        );

        const changedCompaniesById = new Map<
            number,
            DeepPartial<GameCompany>
        >();
        const changedLogosById = new Map<
            number,
            DeepPartial<GameCompanyLogo>
        >();

        for (const company of validCompanies) {
            if (
                company.id == undefined ||
                company.checksum == undefined ||
                existingCompanyChecksums.has(company.checksum) ||
                changedCompaniesById.has(company.id)
            ) {
                continue;
            }

            changedCompaniesById.set(company.id, {
                ...company,
                parentId: company.parent?.id,
            });
        }

        for (const company of validCompanies) {
            const logo = company.logo;
            if (
                logo?.id == undefined ||
                logo.checksum == undefined ||
                existingLogoChecksums.has(logo.checksum) ||
                changedLogosById.has(logo.id)
            ) {
                continue;
            }

            changedLogosById.set(logo.id, {
                ...logo,
            });
        }

        const changedCompanies = [...changedCompaniesById.values()];
        const changedLogos = [...changedLogosById.values()];

        if (changedLogos.length !== 0) {
            const logoRepository =
                this.dataSource.getRepository(GameCompanyLogo);
            await logoRepository.upsert(changedLogos, ["id"]);
        }

        if (changedCompanies.length !== 0) {
            const companyRepository =
                this.dataSource.getRepository(GameCompany);
            await companyRepository.upsert(changedCompanies, ["id"]);
        }
    }

    async handleEngines(incoming: IGDBPartialGame, existing: Game) {
        const repository = this.dataSource.getRepository(GameEngine);
        const engines = incoming.gameEngines ?? [];
        const existingEnginesMap = new Map(
            existing.gameEngines?.map((item) => [item.id, item]),
        );

        if (engines.length === 0) return;

        await this.handleManyToMany(incoming, existing, "gameEngines");

        for (const engine of engines) {
            const existingPlatforms =
                existingEnginesMap.get(engine.id!)?.platforms ?? [];
            const incomingPlatforms = (engine.platforms ??
                []) as GamePlatform[];
            const existingPlatformIds = new Set(
                existingPlatforms.map((platform) => platform.id!),
            );
            const incomingPlatformIds = new Set(
                incomingPlatforms.map((platform) => platform.id!),
            );

            const existingNotInIncoming = existingPlatforms.filter(
                (platform) => !incomingPlatformIds.has(platform.id!),
            );
            const incomingNotInExisting = incomingPlatforms.filter(
                (platform) => !existingPlatformIds.has(platform.id!),
            );

            await repository
                .createQueryBuilder()
                .relation(GameEngine, "platforms")
                .of(engine)
                .addAndRemove(incomingNotInExisting, existingNotInIncoming);
        }
    }

    /**
     * Logic for handling entities that have deep nested relationships that also need to be upserted. <br>
     * Ordering usually matters here.
     * @param incoming
     * @param existing
     */
    async handleDeepNestedEntities(incoming: IGDBPartialGame, existing: Game) {
        const startedAt = this.getProfilingStart();
        if (
            incoming.involvedCompanies != undefined ||
            incoming.gameEngines != undefined
        ) {
            await this.handleCompanies(incoming, existing);
        }

        if (incoming.involvedCompanies) {
            for (const involvedCompany of incoming.involvedCompanies) {
                involvedCompany.companyId = involvedCompany.company?.id;
            }
            await this.handleManyToMany(
                incoming,
                existing,
                "involvedCompanies",
            );
        }

        if (incoming.gameEngines != undefined) {
            await this.handleEngines(incoming, existing);
        }
        this.logProfilingDuration("handleDeepNestedEntities", startedAt, {
            gameId: incoming.id,
        });
    }

    /**
     * Performs mapping of deprecated fields to their new counterparts.
     * @param incoming
     * @private
     */
    private handleDeprecatedFields(incoming: IGDBPartialGame) {
        if (incoming.externalGames) {
            for (const externalGame of incoming.externalGames) {
                externalGame.category =
                    externalGame.category ?? externalGame.externalGameSource;
                externalGame.media =
                    externalGame.media ?? externalGame.gameReleaseFormat;
            }
        }

        incoming.category = incoming.category ?? incoming.gameType;
        incoming.status = incoming.status ?? incoming.gameStatus;
    }

    /**
     * Determines if a checksum-matched game should still run full relation reconciliation.
     *
     * This is intentionally stateless and deterministic:
     * 1. A "time bucket" is derived from epoch weeks: `floor(now / ONE_WEEK_IN_MS)`.
     * 2. The current bucket for this run is `timeBucket % reconcileEveryRuns`.
     * 3. Each game is pinned to a stable bucket using `abs(gameId) % reconcileEveryRuns`.
     * 4. A game is reconciled only when both buckets match.
     *
     * With `reconcileEveryRuns = 4`, this means roughly one quarter of checksum-matched
     * games are reconciled per weekly run, and all buckets are covered across four
     * consecutive weekly runs.
     *
     * Important tradeoff: this does NOT persist per-game execution history, so it provides
     * probabilistic cadence by schedule/bucket, not strict per-game run counting.
     * - Multiple sync runs in the same week can hit the same bucket repeatedly.
     * - Missed weekly runs can delay specific buckets.
     */
    private shouldReconcileRelationsForGame(gameId: number): boolean {
        if (!this.shouldSkipRelationsOnChecksumMatch) {
            return true;
        }

        if (this.reconcileEveryRuns <= 1) {
            return true;
        }

        const runBucket =
            Math.floor(Date.now() / ONE_WEEK_IN_MS) % this.reconcileEveryRuns;
        return Math.abs(gameId) % this.reconcileEveryRuns === runBucket;
    }

    private parsePositiveInteger(
        rawValue: string | undefined,
        fallback: number,
    ): number {
        if (rawValue == undefined) {
            return fallback;
        }

        const parsed = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return fallback;
        }

        return parsed;
    }

    private getProfilingStart(): bigint | null {
        if (!this.shouldProfileSync) {
            return null;
        }

        return process.hrtime.bigint();
    }

    private logProfilingDuration(
        label: string,
        startedAt: bigint | null,
        metadata?: Record<string, unknown>,
    ) {
        if (!this.shouldProfileSync || startedAt == null) {
            return;
        }

        const elapsedInMs =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        this.logger.log(
            `${label} took ${elapsedInMs.toFixed(2)}ms`,
            metadata ?? {},
        );
    }
}
