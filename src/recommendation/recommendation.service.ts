import { Injectable } from "@nestjs/common";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import {
    GetRecommendationsRequestDto,
    RecommendationCriteria,
} from "./dto/get-recommendations.dto";
import { getRandomItem, getRandomItems } from "../utils/getRandomItems";
import { Game } from "../game/game-repository/entities/game.entity";

@Injectable()
export class RecommendationService {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
    ) {}

    private async getRecommendationsByFinished(
        userId: string,
        dto: GetRecommendationsRequestDto,
    ) {
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                userId,
                userId,
                {
                    offset: 0,
                    limit: 9999999,
                },
            );
        const finishedCollectionEntries = collectionEntries.filter(
            (entry) => entry.finishedAt != undefined,
        );
        const gameIds = finishedCollectionEntries.map((entry) => entry.gameId);
        const randomGameIds = getRandomItems(gameIds, dto.limit || 10);
        const games = await this.gameRepositoryService.findAllByIds({
            gameIds: randomGameIds,
            relations: {
                similarGames: true,
            },
        });

        const pickedSimilarGamesIds: number[] = games.map(
            // Picks a single, random, similar game for each item.
            (game) => getRandomItem(game.similarGames!).id,
        );
    }

    async getRecommendations(
        userId: string,
        dto: GetRecommendationsRequestDto,
    ) {
        switch (dto.criteria) {
            case RecommendationCriteria.FINISHED:
                return this.getRecommendationsByFinished(userId, dto);
        }
    }
}
