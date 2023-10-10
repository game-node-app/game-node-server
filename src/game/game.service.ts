import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { In, Repository } from "typeorm";
import { GameAlternativeName } from "./entities/game-alternative-name.entity";
import { GameArtwork } from "./entities/game-artwork.entity";
import { GameCollection } from "./entities/game-collection.entity";
import { GameCover } from "./entities/game-cover.entity";
import { GameScreenshot } from "./entities/game-screenshot.entity";
import { PartialGame } from "./game.types";
import { GameFranchise } from "./entities/game-franchise.entity";
import { GameExternalGame } from "./entities/game-external-game.entity";
import { GameLocalization } from "./entities/game-localization.entity";
import { GameMode } from "./entities/game-mode.entity";
import { GameGenre } from "./entities/game-genre.entity";
import { GameKeyword } from "./game-keyword.entity";
import { GamePlatform } from "./entities/game-platform.entity";

@Injectable()
export class GameService {
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
        return this.gameRepository.findOneBy({
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

    async createOrUpdate(game: PartialGame) {
        if (game.id == null || typeof game.id !== "number") {
            throw new Error("Game ID must be a number.");
        }

        const possibleExistingGame = await this.findOneById(game.id);

        await this.buildParentRelationships(game, possibleExistingGame != null);
        await this.gameRepository.upsert(game, ["id"]);
        await this.buildChildRelationships(game);
    }

    /**
     * Builds relationships that are necessary for the game to be saved (e.g. collections).
     *
     * e.g. Relationships where Game is on the ManyToOne side.
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
        if (game.franchises) {
            const franchises = game.franchises.map((franchise) => {
                return this.gameFranchiseRepository.create({
                    ...franchise,
                });
            });
            await this.gameFranchiseRepository.upsert(franchises, ["id"]);
        }
        if (game.platforms) {
            // Changes to platform.games are not cascaded.
            const platforms = game.platforms.map((platform) => {
                return this.gamePlatformRepository.create({
                    ...platform,
                });
            });
            await this.gamePlatformRepository.upsert(platforms, ["id"]);
        }
    }

    /**
     * Builds child relationships which depend on the game being saved (e.g. alternative names, cover).
     e.g. Relationships where Game is on the OneToMany side.<br>

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
        if (game.externalGames) {
            const externalGames = game.externalGames.map((externalGame) => {
                return this.gameExternalGameRepository.create({
                    ...externalGame,
                });
            });
            await this.gameExternalGameRepository.upsert(externalGames, ["id"]);
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
        if (game.genres) {
            const genres = game.genres.map((genre) => {
                return this.gameGenreRepository.create({
                    ...genre,
                    game: game as Game,
                });
            });
            await this.gameGenreRepository.upsert(genres, ["id"]);
        }
        if (game.keywords) {
            const keywords = game.keywords.map((keyword) => {
                return this.gameKeywordRepository.create({
                    ...keyword,
                    game: game as Game,
                });
            });
            await this.gameKeywordRepository.upsert(keywords, ["id"]);
        }
    }

    async findAll(): Promise<Game[]> {
        return this.gameRepository.find();
    }
}
