import { ActivitiesRepositoryController } from "./activities-repository.controller";
import { ActivitiesRepositoryV2Controller } from "./activities-repository-v2.controller";
import { ActivitiesFeedService } from "../activities-feed/activities-feed.service";
import { ActivityFeedCriteria } from "../activities-feed/dto/activities-feed-request.dto";
import { ActivityType } from "../activities-queue/activities-queue.constants";

describe("Activity viewer forwarding (controllers & feed service)", () => {
    it("forwards session userId (or undefined) from v1 and v2 controllers", async () => {
        const service = {
            findLatestExcludingTypes: jest.fn().mockResolvedValue([[], 0]),
            findOneByOrFail: jest.fn().mockResolvedValue({}),
            findLatest: jest.fn().mockResolvedValue([[], 0]),
        };
        const v1 = new ActivitiesRepositoryController(service as any);
        const v2 = new ActivitiesRepositoryV2Controller(service as any);
        const session = { getUserId: () => "viewer-1" } as any;

        await v1.findLatest({ userId: "author-1" }, session);
        expect(service.findLatestExcludingTypes).toHaveBeenLastCalledWith(
            { userId: "author-1" },
            [ActivityType.OBTAINED_GAME_ACHIEVEMENT],
            "viewer-1",
        );

        await v1.findLatest({ userId: "author-1" }, undefined);
        expect(service.findLatestExcludingTypes).toHaveBeenLastCalledWith(
            { userId: "author-1" },
            [ActivityType.OBTAINED_GAME_ACHIEVEMENT],
            undefined,
        );

        await v1.findOneById("act-1", session);
        expect(service.findOneByOrFail).toHaveBeenLastCalledWith(
            { where: { id: "act-1" } },
            "viewer-1",
        );

        await v1.findOneById("act-1", undefined);
        expect(service.findOneByOrFail).toHaveBeenLastCalledWith(
            { where: { id: "act-1" } },
            undefined,
        );

        await v2.findLatest({ userId: "author-1", type: ActivityType.POST }, session);
        expect(service.findLatest).toHaveBeenLastCalledWith(
            { userId: "author-1", type: ActivityType.POST },
            "viewer-1",
        );

        await v2.findLatest({ userId: "author-1" }, undefined);
        expect(service.findLatest).toHaveBeenLastCalledWith(
            { userId: "author-1" },
            undefined,
        );
    });

    it("passes viewer userId from ActivitiesFeedService into findLatestBy for both criteria", async () => {
        const repoService = {
            findLatestBy: jest.fn().mockResolvedValue([[], 0]),
        };
        const followService = {
            getFollowerInfo: jest.fn().mockResolvedValue([["followed-1"], 1]),
        };
        const feedService = new ActivitiesFeedService(
            repoService as any,
            followService as any,
        );

        await feedService.buildActivitiesFeed("viewer-1", {
            criteria: ActivityFeedCriteria.ALL,
            limit: 10,
            offset: 0,
        });
        expect(repoService.findLatestBy).toHaveBeenLastCalledWith(
            expect.objectContaining({ take: 10, skip: 0 }),
            "viewer-1",
        );

        await feedService.buildActivitiesFeed(undefined, {
            criteria: ActivityFeedCriteria.ALL,
            limit: 10,
            offset: 0,
        });
        expect(repoService.findLatestBy).toHaveBeenLastCalledWith(
            expect.objectContaining({ take: 10, skip: 0 }),
            undefined,
        );

        await feedService.buildActivitiesFeed("viewer-1", {
            criteria: ActivityFeedCriteria.FOLLOWING,
            limit: 10,
            offset: 0,
        });
        expect(repoService.findLatestBy).toHaveBeenLastCalledWith(
            expect.objectContaining({ take: 10, skip: 0 }),
            "viewer-1",
        );
    });
});
