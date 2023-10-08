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

@Injectable()
export class GameService {
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

        await this.buildParentRelationships(game);
        console.log(game.createdAt);
        await this.gameRepository.upsert(game, ["id"]);
        await this.buildChildRelationships(game);
    }

    /**
     * Builds relationships that are necessary for the game to be saved (e.g. collections).
     * e.g. Relationships where Game is on the ManyToOne side.
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
     e.g. Relationships where Game is on the OneToMany side.
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
    }

    async findAll(): Promise<Game[]> {
        return this.gameRepository.find();
    }
}
