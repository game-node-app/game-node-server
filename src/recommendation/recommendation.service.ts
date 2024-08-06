import { Injectable } from "@nestjs/common";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import {
    GetRecommendationsRequestDto,
    GetRecommendationsResponseDto,
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
    ): Promise<GetRecommendationsResponseDto> {
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

        const limitToUse = dto.limit || 10;

        const gameIds = finishedCollectionEntries.map((entry) => entry.gameId);
        const randomGameIds = getRandomItems(gameIds, limitToUse);
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

        return {
            gameIds: pickedSimilarGamesIds,
        };
    }

    /**
     * After retrieving the most popular themes in a user's library, retrieves random games
     * based on one of the 5 most popular themes.
     * @param userId
     * @param dto
     * @private
     */
    private async getRecommendationsByTheme(
        userId: string,
        dto: GetRecommendationsRequestDto,
    ): Promise<GetRecommendationsResponseDto> {
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                userId,
                userId,
                {
                    offset: 0,
                    limit: 9999999,
                },
            );

        const gameIds = collectionEntries.map((entry) => entry.gameId);
        const games = await this.gameRepositoryService.findAllByIds({
            gameIds: gameIds,
            relations: {
                themes: true,
            },
        });

        // Theme id to number of occurrences ratio
        const themesCountMap = new Map<number, number>();

        for (const game of games) {
            if (game.themes == undefined || game.themes.length === 0) {
                continue;
            }

            for (const theme of game.themes) {
                const previousCount = themesCountMap.get(theme.id) ?? 0;
                themesCountMap.set(theme.id, previousCount + 1);
            }
        }

        const orderedThemes = Array.from(themesCountMap.entries()).toSorted(
            (a, b) => {
                return a[1] - b[1];
            },
        );

        // Retrieves the first 5 most popular themes
        const priorityThemes = orderedThemes.slice(0, 5);

        const randomTheme = getRandomItem(priorityThemes);

        // This operation is expensive
        const gamesInTheme =
            await this.gameRepositoryService.findAllIdsWithFilters({
                themes: [randomTheme[0]],
            });

        const randomGamesInTheme = getRandomItems(
            gamesInTheme,
            dto.limit || 10,
        );

        return {
            gameIds: randomGamesInTheme,
            criteriaId: randomTheme[0],
        };
    }

    async getRecommendations(
        userId: string,
        criteria: RecommendationCriteria,
        dto: GetRecommendationsRequestDto,
    ) {
        switch (criteria) {
            case RecommendationCriteria.FINISHED:
                return this.getRecommendationsByFinished(userId, dto);
            case RecommendationCriteria.THEME:
                return this.getRecommendationsByTheme(userId, dto);
        }
    }
}
