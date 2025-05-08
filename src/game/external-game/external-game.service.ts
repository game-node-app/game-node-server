import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { DeepPartial, In, Repository } from "typeorm";
import { days } from "@nestjs/throttler";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { toMap } from "../../utils/toMap";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";

@Injectable()
export class ExternalGameService {
    constructor(
        @InjectRepository(GameExternalGame)
        private readonly gameExternalGameRepository: Repository<GameExternalGame>,
        @InjectRepository(UnmappedExternalGame)
        private readonly unmappedExternalGameRepository: Repository<UnmappedExternalGame>,
    ) {}

    public async upsert(entity: DeepPartial<GameExternalGame>) {
        await this.gameExternalGameRepository.upsert(entity, ["id"]);
    }

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

    public async getUnmappedGames() {
        return this.unmappedExternalGameRepository.find({
            where: {
                isActive: true,
            },
        });
    }

    public async registerUnmappedGame(
        sourceUid: string,
        category: EGameExternalGameCategory,
    ) {
        const existingEntry =
            await this.unmappedExternalGameRepository.findOneBy({
                sourceUid,
                category,
            });

        if (existingEntry) {
            return;
        }

        await this.unmappedExternalGameRepository.insert({
            sourceUid,
            category,
            isActive: true,
        });
    }
}
