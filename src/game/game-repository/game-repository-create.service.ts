import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { DeepPartial, Repository } from "typeorm";
import { GameAlternativeName } from "./entities/game-alternative-name.entity";
import { GameArtwork } from "./entities/game-artwork.entity";
import { GameCollection } from "./entities/game-collection.entity";
import { GameCover } from "./entities/game-cover.entity";
import { GameScreenshot } from "./entities/game-screenshot.entity";
import { GameFranchise } from "./entities/game-franchise.entity";
import { GameExternalGame } from "./entities/game-external-game.entity";
import { GameLocalization } from "./entities/game-localization.entity";
import { GameMode } from "./entities/game-mode.entity";
import { GameGenre } from "./entities/game-genre.entity";
import { GameKeyword } from "./entities/game-keyword.entity";
import { GamePlatform } from "./entities/game-platform.entity";
import { GameInvolvedCompany } from "./entities/game-involved-company.entity";
import { GameCompany } from "./entities/game-company.entity";
import { GameCompanyLogo } from "./entities/game-company-logo.entity";
import { GameTheme } from "./entities/game-theme.entity";
import { GamePlayerPerspective } from "./entities/game-player-perspective.entity";
import { GameEngine } from "./entities/game-engine.entity";
import { GameEngineLogo } from "./entities/game-engine-logo.entity";
import { PartialGame } from "./game-repository.types";
import { StatisticsSourceType } from "../../statistics/statistics.constants";
import { StatisticsQueueService } from "../../statistics/statistics-queue/statistics-queue.service";
import { HltbSyncQueueService } from "../../sync/hltb/hltb-sync-queue.service";

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
     * @param gameAlternativeNameRepository
     * @param gameArtworkRepository
     * @param gameCollectionRepository
     * @param gameCoverRepository
     * @param gameScreenshotRepository
     * @param gameFranchiseRepository
     * @param gameExternalGameRepository
     * @param gameLocalizationRepository
     * @param gameModeRepository
     * @param gameGenreRepository
     * @param gameKeywordRepository
     * @param gamePlatformRepository
     * @param gameInvolvedCompanyRepository
     * @param gameCompanyRepository
     * @param gameCompanyLogoRepository
     * @param gameThemeRepository
     * @param gamePlayerPerspectiveRepository
     * @param gameEngineRepository
     * @param gameEngineLogoRepository
     * @param statisticsQueueService
     */
    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        @InjectRepository(GameAlternativeName)
        private readonly gameAlternativeNameRepository: Repository<GameAlternativeName>,
        @InjectRepository(GameArtwork)
        private readonly gameArtworkRepository: Repository<GameArtwork>,
        @InjectRepository(GameCollection)
        private readonly gameCollectionRepository: Repository<GameCollection>,
        @InjectRepository(GameCover)
        private readonly gameCoverRepository: Repository<GameCover>,
        @InjectRepository(GameScreenshot)
        private readonly gameScreenshotRepository: Repository<GameScreenshot>,
        @InjectRepository(GameFranchise)
        private readonly gameFranchiseRepository: Repository<GameFranchise>,
        @InjectRepository(GameExternalGame)
        private readonly gameExternalGameRepository: Repository<GameExternalGame>,
        @InjectRepository(GameLocalization)
        private readonly gameLocalizationRepository: Repository<GameLocalization>,
        @InjectRepository(GameMode)
        private readonly gameModeRepository: Repository<GameMode>,
        @InjectRepository(GameGenre)
        private readonly gameGenreRepository: Repository<GameGenre>,
        @InjectRepository(GameKeyword)
        private readonly gameKeywordRepository: Repository<GameKeyword>,
        @InjectRepository(GamePlatform)
        private readonly gamePlatformRepository: Repository<GamePlatform>,
        @InjectRepository(GameInvolvedCompany)
        private readonly gameInvolvedCompanyRepository: Repository<GameInvolvedCompany>,
        @InjectRepository(GameCompany)
        private readonly gameCompanyRepository: Repository<GameCompany>,
        @InjectRepository(GameCompanyLogo)
        private readonly gameCompanyLogoRepository: Repository<GameCompanyLogo>,
        @InjectRepository(GameTheme)
        private readonly gameThemeRepository: Repository<GameTheme>,
        @InjectRepository(GamePlayerPerspective)
        private readonly gamePlayerPerspectiveRepository: Repository<GamePlayerPerspective>,
        @InjectRepository(GameEngine)
        private readonly gameEngineRepository: Repository<GameEngine>,
        @InjectRepository(GameEngineLogo)
        private readonly gameEngineLogoRepository: Repository<GameEngineLogo>,
        private readonly statisticsQueueService: StatisticsQueueService,
        private readonly hltbSyncQueueService: HltbSyncQueueService,
    ) {}

    /**
     * Creates or updates a game in our database. <br>
     * ManyToMany models can't be easily upserted, since the junction table is not inserted/updated automatically (without .save).
     * To both fix this and circumvent the .save() bug, use the QueryBuilder with the .relation() method.
     * Bug info: https://github.com/typeorm/typeorm/issues/1754
     * @param game
     */
    async createOrUpdate(game: PartialGame) {
        if (game.id == null || typeof game.id !== "number") {
            throw new Error("Game ID must be a number.");
        } else if (
            game.name == undefined &&
            (game.alternativeNames == undefined ||
                game.alternativeNames.length === 0)
        ) {
            throw new Error(
                "Game name or alternative names must be specified.",
            );
        }

        await this.buildParentRelationships(game);
        await this.gameRepository.upsert(game, ["id"]);
        await this.buildChildRelationships(game);
        this.logger.log(`Upserted game ${game.id} and it's relationships`);
        this.dispatchCreateUpdateEvent(game);
    }

    private dispatchCreateUpdateEvent(game: PartialGame) {
        this.statisticsQueueService.createStatistics({
            sourceId: game.id,
            sourceType: StatisticsSourceType.GAME,
        });
        this.hltbSyncQueueService.createPlaytimeInfo(game.id, game.name!);
    }

    /**
     * Builds relationships that are necessary for the game to be saved (e.g. collections).
     *
     * e.g. Relationships where Game is on the ManyToOne side. Do not update ManyToMany models here.
     * @param game
     */
    async buildParentRelationships(game: PartialGame) {
        if (game.collection) {
            // collection.games changes are not cascaded.
            const collection = this.gameCollectionRepository.create(
                game.collection,
            );
            await this.gameCollectionRepository.upsert(collection, ["id"]);
        }
    }

    /**
     * Builds child relationships which depend on the game being saved (e.g. alternative names, cover).
     e.g. Relationships where Game is on the OneToMany or ManyToMany side.<br>

     <strong> We assume the game is already persisted at this point, so we can use it as a parent.</strong>
     * @param game
     */
    async buildChildRelationships(game: PartialGame) {
        if (game.alternativeNames) {
            const alternativeNames = game.alternativeNames.map(
                (alternativeName) => {
                    return this.gameAlternativeNameRepository.create({
                        ...alternativeName,
                        game: game as Game,
                    });
                },
            );

            await this.gameAlternativeNameRepository.upsert(alternativeNames, [
                "id",
            ]);
        }
        if (game.cover) {
            const cover = this.gameCoverRepository.create(game.cover);
            cover.game = game as Game;
            await this.gameCoverRepository.upsert(cover, ["id"]);
        }

        if (game.gameLocalizations) {
            const localizations = game.gameLocalizations.map((localization) => {
                return this.gameLocalizationRepository.create({
                    ...localization,
                    game: game as Game,
                });
            });
            await this.gameLocalizationRepository.upsert(localizations, ["id"]);
        }

        if (game.screenshots) {
            const screenshots = game.screenshots.map((screenshot) => {
                return this.gameScreenshotRepository.create({
                    ...screenshot,
                    game: game as Game,
                });
            });
            await this.gameScreenshotRepository.upsert(screenshots, ["id"]);
        }
        if (game.artworks) {
            const artworks = game.artworks.map((artwork) => {
                return this.gameArtworkRepository.create({
                    ...artwork,
                    game: game as Game,
                });
            });
            await this.gameArtworkRepository.upsert(artworks, ["id"]);
        }

        /**
         * Many-To-Many relationships are not automatically updated, so we need to do it manually.
         * Use the QueryBuilder with the .relation() method.
         */

        if (game.externalGames) {
            for (const externalGame of game.externalGames) {
                try {
                    await this.gameExternalGameRepository.upsert(externalGame, [
                        "id",
                    ]);
                    await this.gameExternalGameRepository
                        .createQueryBuilder()
                        .relation(Game, "externalGames")
                        .of(game)
                        .add(externalGame);
                } catch (e) {}
            }
        }

        if (game.franchises) {
            for (const franchise of game.franchises) {
                await this.gameFranchiseRepository.upsert(franchise, ["id"]);
                try {
                    await this.gameExternalGameRepository
                        .createQueryBuilder()
                        .relation(Game, "franchises")
                        .of(game)
                        .add(franchise);
                } catch (e) {}
            }
        }

        if (game.platforms) {
            for (const platform of game.platforms) {
                await this.gamePlatformRepository.upsert(platform, ["id"]);
                try {
                    await this.gameExternalGameRepository
                        .createQueryBuilder()
                        .relation(Game, "platforms")
                        .of(game)
                        .add(platform);
                } catch (e) {}
            }
        }

        if (game.keywords) {
            for (const keyword of game.keywords) {
                await this.gameKeywordRepository.upsert(keyword, ["id"]);
                try {
                    await this.gameKeywordRepository
                        .createQueryBuilder()
                        .relation(Game, "keywords")
                        .of(game)
                        .add(keyword);
                } catch (e) {}
            }
        }

        if (game.genres) {
            for (const genre of game.genres) {
                await this.gameGenreRepository.upsert(genre, ["id"]);
                try {
                    await this.gameGenreRepository
                        .createQueryBuilder()
                        .relation(Game, "genres")
                        .of(game)
                        .add(genre);
                } catch (e) {}
            }
        }

        if (game.dlcs) {
            for (const dlc of game.dlcs) {
                await this.gameRepository.upsert(dlc, ["id"]);
                try {
                    await this.gameRepository
                        .createQueryBuilder()
                        .relation(Game, "dlcs")
                        .of(game)
                        .add(dlc);
                } catch (e) {}
            }
        }
        if (game.expansions) {
            for (const expansion of game.expansions) {
                await this.gameRepository.upsert(expansion, ["id"]);
                try {
                    await this.gameRepository
                        .createQueryBuilder()
                        .relation(Game, "expansions")
                        .of(game)
                        .add(expansion);
                } catch (e) {}
            }
        }
        if (game.expandedGames) {
            for (const expandedGame of game.expandedGames) {
                await this.gameRepository.upsert(expandedGame, ["id"]);
                try {
                    await this.gameRepository
                        .createQueryBuilder()
                        .relation(Game, "expandedGames")
                        .of(game)
                        .add(expandedGame);
                } catch (e) {}
            }
        }
        if (game.similarGames) {
            for (const similarGame of game.similarGames) {
                await this.gameRepository.upsert(similarGame, ["id"]);
                try {
                    await this.gameRepository
                        .createQueryBuilder()
                        .relation(Game, "similarGames")
                        .of(game)
                        .add(similarGame);
                } catch (e) {}
            }
        }
        if (game.involvedCompanies) {
            for (const involvedCompany of game.involvedCompanies) {
                if (involvedCompany.company) {
                    await this.handleCompanies([involvedCompany.company]);
                    involvedCompany.companyId = involvedCompany.company.id;
                }

                await this.gameInvolvedCompanyRepository.upsert(
                    involvedCompany,
                    ["id"],
                );
                try {
                    await this.gameInvolvedCompanyRepository
                        .createQueryBuilder()
                        .relation(Game, "involvedCompanies")
                        .of(game)
                        .add(involvedCompany.id);
                } catch (e) {}
            }
        }
        if (game.themes) {
            for (const theme of game.themes) {
                await this.gameThemeRepository.upsert(theme, ["id"]);
                try {
                    await this.gameThemeRepository
                        .createQueryBuilder()
                        .relation(Game, "themes")
                        .of(game)
                        .add(theme);
                } catch (e) {}
            }
        }
        if (game.gameModes) {
            for (const mode of game.gameModes) {
                await this.gameModeRepository.upsert(mode, ["id"]);
                try {
                    await this.gameThemeRepository
                        .createQueryBuilder()
                        .relation(Game, "gameModes")
                        .of(game)
                        .add(mode);
                } catch (e) {}
            }
        }
        if (game.playerPerspectives) {
            for (const playerPerspective of game.playerPerspectives) {
                await this.gamePlayerPerspectiveRepository.upsert(
                    playerPerspective,
                    ["id"],
                );
                try {
                    await this.gamePlayerPerspectiveRepository
                        .createQueryBuilder()
                        .relation(Game, "playerPerspectives")
                        .of(game)
                        .add(playerPerspective);
                } catch (e) {}
            }
        }
        if (game.gameEngines) {
            for (const gameEngine of game.gameEngines) {
                await this.handleCompanies(gameEngine.companies);
                if (gameEngine.logo && typeof gameEngine.logo.id === "number") {
                    await this.gameEngineLogoRepository.upsert(
                        gameEngine.logo,
                        ["id"],
                    );
                }
                await this.gameEngineRepository.upsert(gameEngine, ["id"]);
                try {
                    await this.gameEngineRepository
                        .createQueryBuilder()
                        .relation(Game, "gameEngines")
                        .of(game)
                        .add(gameEngine);
                    await this.gameEngineRepository
                        .createQueryBuilder()
                        .relation(GameEngine, "platforms")
                        .of(gameEngine)
                        .add(gameEngine.platforms);
                } catch (e) {}
            }
        }
    }

    async handleCompanies(
        companies: DeepPartial<GameCompany | undefined>[] | undefined,
    ) {
        if (companies == undefined || companies.length === 0) return;
        for (const originalCompany of companies) {
            // Avoids errors where company.id is transformed to "undefined".
            // Probably TypeORM messing something interanally.
            const company = structuredClone(originalCompany);
            if (company == undefined || typeof company.id !== "number")
                continue;

            if (company.logo && typeof company.logo.id === "number") {
                try {
                    await this.gameCompanyLogoRepository.upsert(company.logo, [
                        "id",
                    ]);
                } catch (e) {}
            }
            /**
             * Not relevant for us for now.
             */
            company.parent = undefined;
            await this.gameCompanyRepository.upsert(company, ["id"]);
        }
    }
}
