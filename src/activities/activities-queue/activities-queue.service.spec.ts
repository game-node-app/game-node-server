import { Test, TestingModule } from "@nestjs/testing";
import { ActivitiesQueueService } from "./activities-queue.service";
import { getQueueToken } from "@nestjs/bullmq";

describe("ActivitiesFeedService", () => {
    let service: ActivitiesQueueService;
    let add: jest.Mock;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ActivitiesQueueService,
                {
                    provide: getQueueToken("activities"),
                    useValue: {
                        add: (add = jest.fn(async () => ({ id: "activity-job" }))),
                    },
                },
            ],
        }).compile();

        service = module.get<ActivitiesQueueService>(ActivitiesQueueService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    it("uses the source identity as the BullMQ job id and returns its acknowledgement", async () => {
        const result = await service.register(
            {
                type: "OBTAINED_GAME_ACHIEVEMENT" as any,
                sourceId: 5,
                profileUserId: "user",
            },
            "activity-OBTAINED_GAME_ACHIEVEMENT-5",
        );

        expect(result).toEqual({ id: "activity-job" });
        expect(add).toHaveBeenCalledWith(
            "register",
            {
                type: "OBTAINED_GAME_ACHIEVEMENT",
                sourceId: 5,
                profileUserId: "user",
            },
            { jobId: "activity-OBTAINED_GAME_ACHIEVEMENT-5" },
        );
    });

    it("returns queue rejection to callers waiting for confirmation", async () => {
        const error = new Error("queue unavailable");
        add.mockRejectedValue(error);

        await expect(
            service.register(
                {
                    type: "OBTAINED_GAME_ACHIEVEMENT" as any,
                    sourceId: 5,
                    profileUserId: "user",
                },
                "activity-OBTAINED_GAME_ACHIEVEMENT-5",
            ),
        ).rejects.toThrow("queue unavailable");
    });
});
