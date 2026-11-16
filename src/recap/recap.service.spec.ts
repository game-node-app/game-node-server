import { RecapService } from "./recap.service";
import { RecapWindowService } from "./recap-window.service";

describe("RecapService", () => {
    const recapRepository = {
        findOneOrFail: jest.fn(),
        existsBy: jest.fn(),
    };
    const profileService = {
        findOneByIdOrFail: jest.fn(),
    };
    const recapWindowService = {
        getRecapPhase: jest.fn(),
    };
    let service: RecapService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new RecapService(
            recapRepository as any,
            profileService as any,
            recapWindowService as any,
        );
    });

    describe("getRecapStatus", () => {
        it("returns the phase alongside the existing flags", async () => {
            profileService.findOneByIdOrFail.mockResolvedValue({
                createdAt: new Date("2024-01-01T00:00:00.000Z"),
            });
            recapRepository.existsBy.mockResolvedValue(true);
            recapWindowService.getRecapPhase.mockResolvedValue("live");

            await expect(
                service.getRecapStatus("user-1", 2026),
            ).resolves.toEqual({
                isRecapCreated: true,
                isRecapEligible: true,
                phase: "live",
            });
            expect(recapWindowService.getRecapPhase).toHaveBeenCalledWith(2026);
        });

        it("returns the phase for an ineligible user too", async () => {
            profileService.findOneByIdOrFail.mockResolvedValue({
                createdAt: new Date("2027-06-01T00:00:00.000Z"),
            });
            recapWindowService.getRecapPhase.mockResolvedValue("closed");

            await expect(
                service.getRecapStatus("user-1", 2026),
            ).resolves.toEqual({
                isRecapCreated: false,
                isRecapEligible: false,
                phase: "closed",
            });
            expect(recapRepository.existsBy).not.toHaveBeenCalled();
        });
    });

    describe("getRecapByUserId", () => {
        it("returns calendar null for an old Recap and derives the new fields", async () => {
            recapRepository.findOneOrFail.mockResolvedValue({
                id: 1,
                profileUserId: "user-1",
                year: 2025,
                totalAddedGames: 4,
                totalFinishedGames: 3,
                totalDroppedGames: 2,
                dailyPlaytimeSeconds: null,
                playedGames: [],
                genres: [],
                themes: [],
                modes: [],
                platforms: [],
            });

            const result = await service.getRecapByUserId("user-1", 2025);

            expect(result.calendar).toBeNull();
            expect(result.backlogGrowth).toBe(0);
            expect(result.topGames).toEqual([]);
            expect(result.playtimeByPlatform).toEqual([]);
        });
    });
});
