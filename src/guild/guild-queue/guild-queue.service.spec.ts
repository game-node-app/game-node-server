import { getQueueToken } from "@nestjs/bullmq";
import { Test, TestingModule } from "@nestjs/testing";
import {
    GUILD_EVAL_DELAY_MS,
    GUILD_EVALUATE_JOB_NAME,
    GUILD_QUEUE_NAME,
} from "./guild-queue.constants";
import { GuildQueueService } from "./guild-queue.service";

describe("GuildQueueService", () => {
    const queue = { add: jest.fn() };
    let service: GuildQueueService;
    let loggerError: jest.SpyInstance;

    beforeEach(async () => {
        jest.clearAllMocks();
        queue.add.mockResolvedValue({});
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GuildQueueService,
                {
                    provide: getQueueToken(GUILD_QUEUE_NAME),
                    useValue: queue,
                },
            ],
        }).compile();

        service = module.get(GuildQueueService);
        loggerError = jest
            .spyOn((service as any).logger, "error")
            .mockImplementation(() => undefined);
    });

    it("delays and deduplicates evaluations per user for two seconds", async () => {
        await service.enqueueEvaluation("u1", "collection_entry");

        expect(queue.add).toHaveBeenCalledWith(
            GUILD_EVALUATE_JOB_NAME,
            { userId: "u1", trigger: "collection_entry" },
            {
                delay: GUILD_EVAL_DELAY_MS,
                backoff: { type: "exponential", delay: 1000 },
                stackTraceLimit: 1,
                deduplication: {
                    id: "guild-eval-u1",
                    ttl: GUILD_EVAL_DELAY_MS,
                },
            },
        );
    });

    it.each(["daily", "post", "collection", "game_achievement"] as const)(
        "forwards the %s trigger",
        async (trigger) => {
            await service.enqueueEvaluation("u1", trigger);

            expect(queue.add).toHaveBeenCalledWith(
                GUILD_EVALUATE_JOB_NAME,
                { userId: "u1", trigger },
                expect.any(Object),
            );
        },
    );

    it("never rejects when the queue is unavailable", async () => {
        queue.add.mockRejectedValue(new Error("redis down"));

        await expect(
            service.enqueueEvaluation("u1", "playtime"),
        ).resolves.toBeUndefined();
        expect(loggerError).toHaveBeenCalledWith(expect.stringContaining("u1"));
    });

    it("swallows a synchronous queue failure", async () => {
        queue.add.mockImplementation(() => {
            throw new Error("redis down");
        });

        await expect(
            service.enqueueEvaluation("u1", "review"),
        ).resolves.toBeUndefined();
    });
});
