import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { In, Repository } from "typeorm";
import { GameAlternativeName } from "./entities/game-alternative-name.entity";
import { GameArtwork } from "./entities/game-artwork.entity";
import { GameCollection } from "./entities/game-collection.entity";
import { GameCover } from "./entities/game-cover.entity";
import { GameScreenshot } from "./entities/game-screenshot.entity";
import { PartialGame } from "./game-repository.types";
import { GameFranchise } from "./entities/game-franchise.entity";
import { GameExternalGame } from "./entities/game-external-game.entity";
import { GameLocalization } from "./entities/game-localization.entity";
import { GameMode } from "./entities/game-mode.entity";
import { GameGenre } from "./entities/game-genre.entity";
import { GameKeyword } from "./entities/game-keyword.entity";
import { GamePlatform } from "./entities/game-platform.entity";

@Injectable()
export class GameRepositoryService {
    /**
     * TODO: Separate into multiple services (?).
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
    ) {}

    async findOneById(id: number): Promise<Game | null> {
        return await this.gameRepository.findOneBy({
            id,
        });
    }

    async findAllByIds(ids: number[]): Promise<Game[]> {
        return this.gameRepository.find({
            where: {
                id: In(ids),
            },
        });
    }

    /**
     * ManyToMany entities can't be easily upserted, since the junction table is not inserted/updated automatically.
     * To both fix this and circumvent the .save() bug, use the QueryBuilder with the .relation() method.
     * https://github.com/typeorm/typeorm/issues/1754
     * @param game
     */
    async createOrUpdate(game: PartialGame) {
        if (game.id == null || typeof game.id !== "number") {
            throw new Error("Game ID must be a number.");
        } else if (
            (game.name == undefined && game.alternativeNames == undefined) ||
            game.alternativeNames?.length === 0
        ) {
            throw new Error(
                "Game name or alternative names must be specified.",
            );
        }

        const possibleExistingGame = await this.findOneById(game.id);

        await this.buildParentRelationships(game, possibleExistingGame != null);
        await this.gameRepository.upsert(game, ["id"]);
        await this.buildChildRelationships(game);
    }

    /**
     * Builds relationships that are necessary for the game to be saved (e.g. collections).
     *
     * e.g. Relationships where Game is on the ManyToOne side. Do not update ManyToMany entities here.
     * @param game
     * @param currentGameExists - If it doesn't and we try to update a
     * parent entity with it, it will try to point to a non-existent game id.
     */
    async buildParentRelationships(
        game: PartialGame,
        currentGameExists: boolean,
    ) {
        const gameValueToUse = currentGameExists ? game : undefined;
        if (game.collection) {
            // collection.games changes are not cascaded.
            const collection = this.gameCollectionRepository.create(
                game.collection,
            );
            await this.gameCollectionRepository.upsert(collection, ["id"]);
        }
        if (game.dlcs) {
            const dlcs = game.dlcs.map((dlc) => {
                return this.gameRepository.create({
                    ...dlc,
                    dlcOf: gameValueToUse,
                });
            });
            await this.gameRepository.upsert(dlcs, ["id"]);
        }
        if (game.expansions) {
            const expansions = game.expansions.map((expansion) => {
                return this.gameRepository.create({
                    ...expansion,
                    expansionOf: gameValueToUse,
                });
            });
            await this.gameRepository.upsert(expansions, ["id"]);
        }
        if (game.expandedGames) {
            const expandedGames = game.expandedGames.map((expandedGame) => {
                return this.gameRepository.create({
                    ...expandedGame,
                    expandedGameOf: gameValueToUse,
                });
            });
            await this.gameRepository.upsert(expandedGames, ["id"]);
        }
        if (game.similarGames) {
            const similarGames = game.similarGames.map((similarGame) => {
                return this.gameRepository.create({
                    ...similarGame,
                    similarGameOf: gameValueToUse,
                });
            });
            await this.gameRepository.upsert(similarGames, ["id"]);
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

        if (game.localizations) {
            const localizations = game.localizations.map((localization) => {
                return this.gameLocalizationRepository.create({
                    ...localization,
                    game: game as Game,
                });
            });
            await this.gameLocalizationRepository.upsert(localizations, ["id"]);
        }
        if (game.gameModes) {
            const modes = game.gameModes.map((mode) => {
                return this.gameModeRepository.create({
                    ...mode,
                    game: game as Game,
                });
            });
            await this.gameModeRepository.upsert(modes, ["id"]);
        }

        /**
         * Many-To-Many relationships are not automatically updated, so we need to do it manually.
         * Use the QueryBuilder with the .relation() method.
         */

        if (game.externalGames) {
            for (const externalGame of game.externalGames) {
                await this.gameExternalGameRepository.upsert(externalGame, [
                    "id",
                ]);
                try {
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
    }

    async findAll(): Promise<Game[]> {
        return this.gameRepository.find();
    }
}
