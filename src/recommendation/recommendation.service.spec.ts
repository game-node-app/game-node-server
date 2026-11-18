import { RecommendationService } from "./recommendation.service";
import { RecommendationCriteria } from "./dto/get-recommendations.dto";
import { MINIMUM_CRITIC_REVIEWS } from "../game/game-filter/game-filter.constants";

function build(games: unknown[]) {
    const gameRepositoryService = {
        findAllByIds: jest.fn(async () => games),
        findAllIdsWithFilters: jest.fn(async () => [{ id: 1 }, { id: 2 }]),
    };
    const collectionsEntriesService = {
        findAllByUserIdWithPermissions: jest.fn(async () => [
            [{ gameId: 10 }],
            1,
        ]),
    };
    const gameFilterService = {
        removeMature: jest.fn(async (ids: number[]) => ids),
    };
    const service = new RecommendationService(
        gameRepositoryService as never,
        collectionsEntriesService as never,
        gameFilterService as never,
    );

    return { service, gameRepositoryService };
}

describe("RecommendationService", () => {
    it("only recommends similar games with the minimum critic reviews", async () => {
        const { service } = build([
            {
                id: 10,
                similarGames: [
                    { id: 1, aggregatedRatingCount: null },
                    { id: 2, aggregatedRatingCount: 1 },
                ],
            },
        ]);

        const result = await service.getRecommendations("user", {
            criteria: RecommendationCriteria.PLAYED,
            limit: 10,
        });

        expect(result).toEqual({ gameIds: [2] });
    });

    it("filters genre candidates by the minimum critic reviews", async () => {
        const { service, gameRepositoryService } = build([
            { id: 10, genres: [{ id: 12 }] },
        ]);

        await service.getRecommendations("user", {
            criteria: RecommendationCriteria.GENRE,
            limit: 1,
        });

        expect(
            gameRepositoryService.findAllIdsWithFilters,
        ).toHaveBeenCalledWith({
            genres: [12],
            minCriticReviewCount: MINIMUM_CRITIC_REVIEWS,
        });
    });
});
