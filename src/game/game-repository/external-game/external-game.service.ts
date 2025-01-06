import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameExternalGame } from "../entities/game-external-game.entity";
import { In, Repository } from "typeorm";
import { days } from "@nestjs/throttler";
import { EGameExternalGameCategory } from "../game-repository.constants";
import { toMap } from "../../../utils/toMap";
import { Game } from "../entities/game.entity";

@Injectable()
export class ExternalGameService {
    constructor(
        @InjectRepository(GameExternalGame)
        private readonly gameExternalGameRepository: Repository<GameExternalGame>,
    ) {}

    private reOrderBySourceIds(
        originalIds: string[],
        unOrderedGames: GameExternalGame[],
    ) {
        const gamesMap = toMap(unOrderedGames, "uid");

        return originalIds
            .map((id) => {
                return gamesMap.get(id);
            })
            .filter((game) => game != undefined) as GameExternalGame[];
    }

    async getExternalGamesForGameIds(gameIds: number[]) {
        return this.gameExternalGameRepository.find({
            where: {
                gameId: In(gameIds),
            },
            cache: {
                id: `external-games-ids-${gameIds}`,
                milliseconds: days(1),
            },
        });
    }

    /**
     * Returns a list of GameExternalGame for each sourceId (referred to as uid)
     * @param sourceIds
     * @param category
     */
    public async getExternalGamesForSourceIds(
        sourceIds: string[],
        category: EGameExternalGameCategory,
    ) {
        const externalGames = await this.gameExternalGameRepository.find({
            where: {
                uid: In(sourceIds),
                category,
            },
            cache: {
                id: `external-games-ids-${category}-${sourceIds}`,
                milliseconds: days(1),
            },
        });

        return this.reOrderBySourceIds(sourceIds, externalGames);
    }
}
