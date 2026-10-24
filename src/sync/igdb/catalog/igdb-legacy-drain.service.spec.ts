import { Queue } from "bullmq";
import { IgdbLegacyDrainService } from "./igdb-legacy-drain.service";

describe("legacy cutover drain gate", () => {
    const counts: Record<string, number> = {
        waiting: 0,
        active: 0,
        delayed: 0,
        "waiting-children": 0,
        failed: 0,
    };
    const redis = {
        get: jest.fn(),
        set: jest.fn(),
        zrange: jest.fn().mockResolvedValue(["failed-1", "1"]),
    };
    const queue = {
        getJobCounts: jest.fn(async () => ({ ...counts })),
        client: Promise.resolve(redis),
        toKey: (key: string) => `igdb-test-${key}`,
    };
    const gate = new IgdbLegacyDrainService(queue as unknown as Queue);
    beforeEach(() => {
        for (const key of Object.keys(counts)) counts[key] = 0;
        redis.get.mockReset();
        redis.set.mockReset();
    });
    it.each(["waiting", "active", "delayed", "waiting-children"])(
        "blocks %s jobs independently",
        async (state) => {
            counts[state] = 1;
            expect(await gate.isDrained()).toBe(false);
        },
    );
    it("blocks retained failures until explicit acknowledgment and invalidates acknowledgment for new failures", async () => {
        counts.failed = 1;
        expect(await gate.isDrained()).toBe(false);
        await gate.acknowledgeFailures();
        redis.get.mockResolvedValue(redis.set.mock.calls[0][1]);
        expect(await gate.isDrained()).toBe(true);
        redis.zrange.mockResolvedValueOnce(["failed-2", "2"]);
        expect(await gate.isDrained()).toBe(false);
    });
    it("permits an empty legacy queue", async () => {
        expect(await gate.isDrained()).toBe(true);
    });
});
