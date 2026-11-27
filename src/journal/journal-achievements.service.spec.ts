import { JournalAchievementsService } from "./journal-achievements.service";
import { setCacheManager } from "../utils/cacheable";

describe("JournalAchievementsService", () => {
    beforeAll(() => {
        // No-op cache so every call is a miss.
        setCacheManager({
            get: async () => undefined,
            set: async () => undefined,
        } as never);
    });

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
});
