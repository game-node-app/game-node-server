process.env.REDIS_URL ??= "redis://localhost:6379";
import {
    JOURNAL_BUILDS_KEY,
    JournalAchievementsService,
} from "./journal-achievements.service";
import { setCacheManager } from "../utils/cacheable";
import { limiterRedis } from "../utils/redis-semaphore";

describe("JournalAchievementsService", () => {
    beforeAll(async () => {
        // No-op cache so every call is a miss.
        setCacheManager({
            get: async () => undefined,
            set: async () => undefined,
        } as never);
        // Commands fail open until the connection is ready, which would let every build through.
        const redis = limiterRedis();
        if (redis.status !== "ready")
            await new Promise((resolve) => redis.once("ready", resolve));
        await redis.del(JOURNAL_BUILDS_KEY);
    });
    afterAll(() => limiterRedis().disconnect());

    it("shares one build between concurrent calls and caps the per-game fan-out", async () => {
        const obtained = Array.from({ length: 12 }, (_, i) => ({
            externalGameId: i,
            externalId: `a${i}`,
            obtainedAt: new Date(2025, 0, 1),
            isObtained: true,
            source: 1,
            gameId: i,
        }));
        const findAllObtainedByUserId = jest
            .fn()
            .mockResolvedValue([obtained, obtained.length]);
        let active = 0;
        let maxActive = 0;
        const findAllByExternalGameId = jest.fn(async (externalGameId) => {
            maxActive = Math.max(maxActive, ++active);
            await new Promise((r) => setTimeout(r, 1));
            active--;
            return [{ externalGameId, externalId: `a${externalGameId}` }];
        });
        const service = new JournalAchievementsService(
            { findAllByExternalGameId } as never,
            { findAllObtainedByUserId } as never,
        );

        const [first, second] = await Promise.all([
            service.buildObtainedAchievementsJournal("user"),
            service.buildObtainedAchievementsJournal("user"),
        ]);

        expect(findAllObtainedByUserId).toHaveBeenCalledTimes(1);
        expect(second).toEqual(JSON.parse(JSON.stringify(first)));
        expect(findAllByExternalGameId).toHaveBeenCalledTimes(12);
        expect(maxActive).toBeLessThanOrEqual(5);
        expect(first.years[0].totalObtained).toBe(12);
    });

    it("runs at most four cold builds at once across users", async () => {
        let active = 0;
        let maxActive = 0;
        const findAllObtainedByUserId = jest.fn(async () => {
            maxActive = Math.max(maxActive, ++active);
            await new Promise((r) => setTimeout(r, 20));
            active--;
            return [[], 0];
        });
        const service = new JournalAchievementsService(
            {} as never,
            { findAllObtainedByUserId } as never,
        );

        await Promise.all(
            ["a", "b", "c", "d", "e", "f"].map((user) =>
                service.buildObtainedAchievementsJournal(user),
            ),
        );

        expect(findAllObtainedByUserId).toHaveBeenCalledTimes(6);
        expect(maxActive).toBe(4);
    });
});
