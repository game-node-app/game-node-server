import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, DeepPartial, In, Repository } from "typeorm";
import { Game } from "../entities/game.entity";
import { GameAlternativeName } from "../entities/game-alternative-name.entity";
import { GameArtwork } from "../entities/game-artwork.entity";
import { GameCover } from "../entities/game-cover.entity";
import { GameScreenshot } from "../entities/game-screenshot.entity";
import { GameFranchise } from "../entities/game-franchise.entity";
import { GameLocalization } from "../entities/game-localization.entity";
import { GameMode } from "../entities/game-mode.entity";
import { GameGenre } from "../entities/game-genre.entity";
import { GameKeyword } from "../entities/game-keyword.entity";
import { GamePlatform } from "../entities/game-platform.entity";
import { GameInvolvedCompany } from "../entities/game-involved-company.entity";
import { GameCompany } from "../entities/game-company.entity";
import { GameCompanyLogo } from "../entities/game-company-logo.entity";
import { GameTheme } from "../entities/game-theme.entity";
import { GamePlayerPerspective } from "../entities/game-player-perspective.entity";
import { GameEngine } from "../entities/game-engine.entity";
import { GameEngineLogo } from "../entities/game-engine-logo.entity";
import { StatisticsQueueService } from "../../../statistics/statistics-queue/statistics-queue.service";
import { ExternalGameService } from "../../external-game/external-game.service";
import { IGDBPartialGame } from "../game-repository.types";
import { StatisticsSourceType } from "../../../statistics/statistics.constants";
import {
    handleManyToMany,
    handleOneToMany,
    handleOneToOne,
} from "./game-repository-create.utils";
import { GameExternalGame } from "../../external-game/entity/game-external-game.entity";
import { toMap } from "../../../utils/toMap";

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
            return;
        }

        const existing = await this.gameRepository.findOne({
            where: { id: game.id },
            select: { id: true, checksum: true },
        });

        if (existing == undefined || existing.checksum !== game.checksum) {
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

        await handleOneToOne(
            incoming,
            existing,
            "cover",
            this.dataSource.getRepository(GameCover),
        );
        await handleOneToMany(
            incoming,
            existing,
            "alternativeNames",
            this.dataSource.getRepository(GameAlternativeName),
        );
        await handleOneToMany(
            incoming,
            existing,
            "artworks",
            this.dataSource.getRepository(GameArtwork),
        );
        await handleOneToMany(
            incoming,
            existing,
            "screenshots",
            this.dataSource.getRepository(GameScreenshot),
        );
        await handleOneToMany(
            incoming,
            existing,
            "gameLocalizations",
            this.dataSource.getRepository(GameLocalization),
        );
        await handleManyToMany(
            incoming,
            existing,
            "externalGames",
            this.dataSource.getRepository(GameExternalGame),
        );
        await handleManyToMany(
            incoming,
            existing,
            "franchises",
            this.dataSource.getRepository(GameFranchise),
        );
        await handleManyToMany(
            incoming,
            existing,
            "platforms",
            this.dataSource.getRepository(GamePlatform),
        );
        await handleManyToMany(
            incoming,
            existing,
            "keywords",
            this.dataSource.getRepository(GameKeyword),
        );
        await handleManyToMany(
            incoming,
            existing,
            "genres",
            this.dataSource.getRepository(GameGenre),
        );
        await handleManyToMany(
            incoming,
            existing,
            "dlcs",
            this.dataSource.getRepository(Game),
        );
        await handleManyToMany(
            incoming,
            existing,
            "expansions",
            this.dataSource.getRepository(Game),
        );
        await handleManyToMany(
            incoming,
            existing,
            "expandedGames",
            this.dataSource.getRepository(Game),
        );
        await handleManyToMany(
            incoming,
            existing,
            "similarGames",
            this.dataSource.getRepository(Game),
        );
        await handleManyToMany(
            incoming,
            existing,
            "themes",
            this.dataSource.getRepository(GameTheme),
        );
        await handleManyToMany(
            incoming,
            existing,
            "gameModes",
            this.dataSource.getRepository(GameMode),
        );
        await handleManyToMany(
            incoming,
            existing,
            "playerPerspectives",
            this.dataSource.getRepository(GamePlayerPerspective),
        );

        for (const externalGame of incoming.externalGames) {
            externalGame.category =
                externalGame.category ?? externalGame.externalGameSource;
            externalGame.media =
                externalGame.media ?? externalGame.gameReleaseFormat;
        }

        await this.handleDeepNestedEntities(incoming, existing);
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

        await handleManyToMany(incoming, existing, "gameEngines", repository);

        for (const engine of engines) {
            const existingPlatforms =
                existingEnginesMap.get(engine.id!)?.platforms ?? [];
            const existingPlatformsMap = toMap(existingPlatforms, "id");
            const changedPlatforms = (engine.platforms ?? []).filter(
                (platform) => !existingPlatformsMap.has(platform.id!),
            );

            if (changedPlatforms.length === 0) continue;

            await repository
                .createQueryBuilder()
                .relation(GameEngine, "platforms")
                .of(engine)
                .add(changedPlatforms);
        }
    }

    /**
     * Logic for handling entities that have deep nested relationships that also need to be upserted.
     * @param incoming
     * @param existing
     */
    async handleDeepNestedEntities(incoming: IGDBPartialGame, existing: Game) {
        await this.handleCompanies(incoming, existing);

        if (incoming.involvedCompanies) {
            for (const involvedCompany of incoming.involvedCompanies) {
                involvedCompany.companyId = involvedCompany.company?.id;
            }
            await handleManyToMany(
                incoming,
                existing,
                "involvedCompanies",
                this.dataSource.getRepository(GameInvolvedCompany),
            );
        }

        await this.handleEngines(incoming, existing);
    }
}
