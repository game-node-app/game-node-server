import { ReviewsService } from "./reviews.service";

function fixture(existing: any = null) {
    const events: string[] = [];
    const repository = {
        findOne: jest.fn().mockResolvedValue(existing),
        merge: jest.fn((review, input) => Object.assign(review, input)),
        update: jest.fn(async () => {
            events.push("updated");
        }),
        create: jest.fn((review) => review),
        manager: {
            transaction: jest.fn(
                async (action: (manager: any) => Promise<any>) => {
                    const saved = await action({
                        queryRunner: { isTransactionActive: true },
                        connection: { options: {} },
                        query: async () => ({ insertId: 1 }),
                        getRepository: () => ({
                            save: async (review: any) => {
                                events.push("inserted");
                                return { ...review, id: "review" };
                            },
                        }),
                    });
                    events.push("committed");
                    return saved;
                },
            ),
        },
    };
    const guildQueue = {
        enqueueEvaluation: jest.fn(() => {
            events.push("enqueued");
            return Promise.resolve();
        }),
    };
    const service = new ReviewsService(
        repository as any,
        { register: jest.fn() } as any,
        {
            findOneByUserIdAndGameIdOrFail: async () => ({ id: "entry" }),
        } as any,
        { addTrackingJob: jest.fn() } as any,
        { registerLevelExpIncreaseActivity: jest.fn() } as any,
        undefined,
        guildQueue as any,
    );
    return { service, repository, guildQueue, events };
}

describe("guild contract evaluation hook", () => {
    test("schedules evaluation after the new review is committed", async () => {
        const { service, guildQueue, events } = fixture();

        await service.createOrUpdate("user", { gameId: 1, rating: 5 });

        expect(events).toEqual(["inserted", "committed", "enqueued"]);
        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledWith(
            "user",
            "review",
        );
    });

    test("does not wait for the evaluation queue before returning", async () => {
        const { service, guildQueue, events } = fixture();
        guildQueue.enqueueEvaluation.mockReturnValue(new Promise(() => {}));

        await expect(
            service.createOrUpdate("user", { gameId: 1, rating: 5 }),
        ).resolves.toBeUndefined();

        expect(events).toContain("committed");
    });

    test("schedules evaluation after an existing review is edited", async () => {
        const { service, guildQueue, events } = fixture({
            id: "review",
            rating: 3,
        });

        await service.createOrUpdate("user", { gameId: 1, rating: 5 });

        expect(events).toEqual(["updated", "enqueued"]);
        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledWith(
            "user",
            "review",
        );
    });
});
