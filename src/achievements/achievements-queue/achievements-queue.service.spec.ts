import { Test, TestingModule } from "@nestjs/testing";
import { AchievementsQueueService } from "./achievements-queue.service";
import {
    ACHIEVEMENTS_BACKFILL_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
    ACHIEVEMENTS_TRACKING_DELAY_MS,
} from "./achievements-queue.constants";
import { getQueueToken } from "@nestjs/bullmq";
import { AchievementsQueueProcessor } from "./achievements-queue.processor";
import { AchievementsBackfillProcessor } from "./achievements-backfill.processor";

describe("AchievementsQueueService and processors", () => {
    let service: AchievementsQueueService;
    const queue = { add: jest.fn(async () => ({})) };
    const backfillQueue = { add: jest.fn(async () => ({})) };

    beforeEach(async () => {
        jest.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AchievementsQueueService,
                {
                    provide: getQueueToken(ACHIEVEMENTS_QUEUE_NAME),
                    useValue: queue,
                },
                {
                    provide: getQueueToken(ACHIEVEMENTS_BACKFILL_QUEUE_NAME),
                    useValue: backfillQueue,
                },
            ],
        }).compile();

        service = module.get(AchievementsQueueService);
    });

    it("delays and deduplicates tracking jobs per user and metric", async () => {
        await service.addTrackingJob({ userId: "u1", metric: "followers" });

        expect(queue.add).toHaveBeenCalledWith(
            ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
            { userId: "u1", metric: "followers" },
            {
                delay: ACHIEVEMENTS_TRACKING_DELAY_MS,
                deduplication: {
                    id: "ach-u1-followers",
                    ttl: ACHIEVEMENTS_TRACKING_DELAY_MS,
                },
            },
        );
    });

    it("gives backfill batches deterministic ids", async () => {
        await service.addBackfillJob({
            definitionId: "boo",
            afterUserId: null,
            generation: 2,
        });
        await service.addBackfillJob({
            definitionId: "boo",
            afterUserId: "u9",
            generation: 2,
        });

        expect(
            backfillQueue.add.mock.calls.map((call: any[]) => call[2].jobId),
        ).toEqual(["ach-backfill-boo-2-start", "ach-backfill-boo-2-u9"]);
    });

    it("the tracking processor awaits the evaluation so failures are retried", async () => {
        const evaluate = jest.fn().mockRejectedValue(new Error("db down"));
        const processor = new AchievementsQueueProcessor({ evaluate } as any);

        await expect(
            processor.process({
                name: ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
                data: { userId: "u1", metric: "followers" },
            } as any),
        ).rejects.toThrow("db down");
        expect(evaluate).toHaveBeenCalledWith("u1", "followers");
    });

    it("the backfill processor chains the next batch until the cursor ends", async () => {
        const backfill = jest
            .fn()
            .mockResolvedValueOnce("u500")
            .mockResolvedValueOnce(null);
        const processor = new AchievementsBackfillProcessor(
            { backfill } as any,
            service,
        );
        const job = {
            data: { definitionId: "boo", afterUserId: null, generation: 1 },
        } as any;

        await processor.process(job);
        await processor.process({
            data: { ...job.data, afterUserId: "u500" },
        } as any);

        expect(backfill.mock.calls).toEqual([
            ["boo", null],
            ["boo", "u500"],
        ]);
        expect(backfillQueue.add).toHaveBeenCalledTimes(1);
        expect(backfillQueue.add).toHaveBeenCalledWith(
            expect.any(String),
            { definitionId: "boo", afterUserId: "u500", generation: 1 },
            { jobId: "ach-backfill-boo-1-u500" },
        );
    });
});
