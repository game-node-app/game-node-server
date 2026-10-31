jest.mock("../statistics/statistics-target.repository", () => ({
    createStatisticsTarget: jest.fn(async () => 1),
}));
import { ReviewsService } from "../reviews/reviews.service";
import { AwardsVoteService } from "../awards/vote/awards-vote.service";

describe("achievement producers", () => {
    it("creating a review evaluates reviews_written", async () => {
        const achievements = { addTrackingJob: jest.fn() };
        const manager = {
            getRepository: () => ({
                save: async (row: any) => ({ ...row, id: "review" }),
            }),
        };
        const service = new ReviewsService(
            {
                findOne: async () => null,
                create: (row: any) => row,
                manager: { transaction: (work: any) => work(manager) },
            } as any,
            { register: jest.fn() } as any,
            {
                findOneByUserIdAndGameIdOrFail: async () => ({ id: "entry" }),
            } as any,
            achievements as any,
            { registerLevelExpIncreaseActivity: jest.fn() } as any,
        );

        await service.createOrUpdate("user", {
            gameId: 1,
            rating: 5,
            content: "ok",
        } as any);

        expect(achievements.addTrackingJob).toHaveBeenCalledWith({
            userId: "user",
            metric: "reviews_written",
        });
    });

    it("voting in the awards evaluates awards_participation", async () => {
        const achievements = { addTrackingJob: jest.fn() };
        const service = new AwardsVoteService(
            { findOneBy: async () => null, save: async () => ({}) } as any,
            {
                getEventByCategoryId: async () => ({
                    year: 2025,
                    votingStartDate: new Date(Date.now() - 60_000),
                    votingEndDate: new Date(Date.now() + 60_000),
                }),
            } as any,
            { findOneByIdOrFail: async () => ({ name: "Game" }) } as any,
            achievements as any,
        );

        await service.registerVote("user", { categoryId: 1, gameId: 1 });

        expect(achievements.addTrackingJob).toHaveBeenCalledWith({
            userId: "user",
            metric: "awards_participation",
        });
    });
});
