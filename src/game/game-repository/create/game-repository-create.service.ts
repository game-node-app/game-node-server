import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, DeepPartial, ObjectLiteral, Repository } from "typeorm";
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
import { toMap } from "../../../utils/toMap";
import { GamePropertyPathToEntityMap } from "../game-repository.constants";
import { GamePlatform } from "../entities/game-platform.entity";
import { ArrayKeys, NonArrayKeys } from "../../../utils/arrayKeys";

/**
 * Service responsible for data inserting and updating for all game-related models.
 * PS: Only make changes to this service if you are sure it won't break the sync process.
 */
@Injectable()
export class GameRepositoryCreateService {
    private readonly logger = new Logger(GameRepositoryCreateService.name);

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
    ) {}

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
        const shouldProcess = await this.isValidEntry(game);

        if (!shouldProcess) {
            return {
                upserted: false,
                propertiesUpdated: [],
            };
        }

        const existing = await this.gameRepository.findOne({
            where: { id: game.id },
            select: { id: true, checksum: true },
        });

        if (existing == undefined || existing.checksum !== game.checksum) {
            this.logger.log(`Upserting game ${game.id} - ${game.name}`);
            await this.gameRepository.upsert(game, ["id"]);
        }

        await this.processRelationships(game);

        const isUpdateAction = existing != undefined;
        this.dispatchCreateUpdateEvent(game, isUpdateAction);
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
        const existing = await this.gameRepository.findOneOrFail({
            where: { id: incoming.id },
            relations: {
                franchises: true,
                platforms: true,
                keywords: true,
                genres: true,
                dlcs: true,
                expansions: true,
                expandedGames: true,
                similarGames: true,
                involvedCompanies: {
                    company: {
                        logo: true,
                    },
                },
                themes: true,
                gameModes: true,
                playerPerspectives: true,
                gameEngines: {
                    companies: {
                        logo: true,
                    },
                    platforms: true,
                },
            },
            select: {
                id: true,
                franchises: { id: true, checksum: true },
                platforms: { id: true, checksum: true },
                keywords: { id: true, checksum: true },
                genres: { id: true, checksum: true },
                dlcs: { id: true, checksum: true },
                expansions: { id: true, checksum: true },
                expandedGames: { id: true, checksum: true },
                similarGames: { id: true, checksum: true },
                themes: { id: true, checksum: true },
                gameModes: { id: true, checksum: true },
                playerPerspectives: { id: true, checksum: true },
                involvedCompanies: {
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
                },
                gameEngines: {
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
                },
            },
            relationLoadStrategy: "query",
        });

        // Treatment for deprecated fields
        for (const externalGame of incoming.externalGames) {
            externalGame.category =
                externalGame.category ?? externalGame.externalGameSource;
            externalGame.media =
                externalGame.media ?? externalGame.gameReleaseFormat;
        }

        const relationsPromises: Promise<void>[] = [
            this.handleOneToOne(incoming, existing, "cover"),
            this.handleOneToMany(incoming, existing, "alternativeNames"),
            this.handleOneToMany(incoming, existing, "artworks"),
            this.handleOneToMany(incoming, existing, "screenshots"),
            this.handleOneToMany(incoming, existing, "gameLocalizations"),
            this.handleManyToMany(incoming, existing, "franchises"),
            this.handleManyToMany(incoming, existing, "platforms"),
            this.handleManyToMany(incoming, existing, "keywords"),
            this.handleManyToMany(incoming, existing, "genres"),
            this.handleManyToMany(incoming, existing, "dlcs"),
            this.handleManyToMany(incoming, existing, "expansions"),
            this.handleManyToMany(incoming, existing, "expandedGames"),
            this.handleManyToMany(incoming, existing, "similarGames"),
            this.handleManyToMany(incoming, existing, "themes"),
            this.handleManyToMany(incoming, existing, "gameModes"),
            this.handleManyToMany(incoming, existing, "playerPerspectives"),
            this.handleManyToMany(incoming, existing, "externalGames"),
        ];

        await Promise.all(relationsPromises);

        await this.handleDeepNestedEntities(incoming, existing);
    }

    async handleManyToMany<
        K extends ArrayKeys<Game>,
        V extends Game[K],
        E extends V extends Array<infer U extends ObjectWithChecksum>
            ? U
            : never,
    >(incoming: IGDBPartialGame, existing: Game, propertyPath: K) {
        const target = GamePropertyPathToEntityMap[propertyPath]!;
        const repository = this.dataSource.getRepository(
            GamePropertyPathToEntityMap[propertyPath]!,
        );
        const incomingData = incoming[propertyPath] as E[];
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

        const existingNotInIncoming = existingData?.filter((item) => {
            return !incomingData.some(
                (incomingItem) => incomingItem.id === item.id,
            );
        });

        const incomingNotInExisting = incomingData?.filter((item) => {
            if (!existingData) return true;

            return !existingData.some(
                (existingItem) => existingItem.id === item.id,
            );
        });

        /**
         * Only performs upsert if entity is not self referencing (Game to Game relations).
         */
        if (!(target instanceof Game)) {
            this.logger.log(
                `Upserting ${incomingParsed.length} items for ${String(propertyPath)}`,
            );
            await repository.upsert(incomingParsed, ["id"]);
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

        this.logger.log(
            `Upserting item for ${String(propertyPath)} - ID: ${incomingData.id}`,
        );

        await repository.upsert(
            { ...incomingData, game: existing, gameId: existing.id },
            ["id"],
        );
        await repository
            .createQueryBuilder()
            .relation(Game, propertyPath)
            .of(existing)
            .set(incomingData);
    }

    async handleCompanies(incoming: IGDBPartialGame, existing: Game) {
        const companies =
            incoming.involvedCompanies?.map((ic) => ic.company) ?? [];
        companies.push(
            ...(incoming.gameEngines?.flatMap((ge) => ge.companies) ?? []),
        );

        if (companies.length === 0) return;

        const existingCompanies: GameCompany[] = [];
        existingCompanies.push(
            ...existing.involvedCompanies.flatMap((ic) => ic.company),
        );
        existingCompanies.push(
            ...existing.gameEngines.flatMap((ge) => ge.companies),
        );

        const validCompanies = companies.filter(
            Boolean,
        ) as DeepPartial<GameCompany>[];

        const existingCompaniesMap = toMap(existingCompanies, "checksum");
        const existingLogos = existingCompanies
            .map((company) => company.logo)
            .filter(Boolean) as GameCompanyLogo[];
        const existingLogosMap = toMap(existingLogos, "checksum");

        /**
         * These objects should be cloned because TypeORM sometimes messes with the entity ids on insert.
         */
        const changedCompanies = validCompanies
            .filter(
                (company) =>
                    company.checksum != undefined &&
                    !existingCompaniesMap.has(company.checksum),
            )
            .map((company) => {
                company.parentId = company.parent?.id;
                return structuredClone(company);
            });
        const changedLogos = validCompanies
            .flatMap((company) => structuredClone(company.logo))
            .filter((logo) => {
                return (
                    logo != undefined &&
                    logo.checksum != undefined &&
                    !existingLogosMap.has(logo.checksum)
                );
            }) as DeepPartial<GameCompanyLogo>[];

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
        const existingEnginesMap = toMap(existing.gameEngines, "id");

        if (engines.length === 0) return;

        await this.handleManyToMany(incoming, existing, "gameEngines");

        for (const engine of engines) {
            const existingPlatforms =
                existingEnginesMap.get(engine.id!)?.platforms ?? [];
            const existingPlatformsMap = toMap(existingPlatforms, "id");
            const incomingPlatforms = (engine.platforms ??
                []) as GamePlatform[];
            const incomingPlatformsMap = toMap(incomingPlatforms, "id");

            const existingNotInIncoming = existingPlatforms.filter(
                (platform) => !incomingPlatformsMap.has(platform.id!),
            );
            const incomingNotInExisting = (engine.platforms ?? []).filter(
                (platform) => !existingPlatformsMap.has(platform.id!),
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
        await this.handleCompanies(incoming, existing);

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

        await this.handleEngines(incoming, existing);
    }
}
