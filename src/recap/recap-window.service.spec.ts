import { BadRequestException } from "@nestjs/common";
import { RecapWindowService } from "./recap-window.service";

describe("RecapWindowService", () => {
    const editionRepository = {
        findOne: jest.fn(),
        upsert: jest.fn(),
    };
    const queryResultCache = { remove: jest.fn() };
    const dataSource = { queryResultCache };
    let service: RecapWindowService;

    beforeEach(() => {
        jest.clearAllMocks();
        editionRepository.findOne.mockResolvedValue(null);
        service = new RecapWindowService(
            editionRepository as any,
            dataSource as any,
        );
    });

    it("defaults a year to opening on 15 November 00:00 UTC", async () => {
        const current = await service.getCurrentRecap(
            new Date("2026-11-15T00:00:00.000Z"),
        );

        expect(current).toEqual({
            year: 2026,
            phase: "live",
            opensAt: new Date("2026-11-15T00:00:00.000Z"),
            closesAt: new Date("2026-12-31T23:59:59.999Z"),
        });
    });

    it("honours a stored later opening", async () => {
        editionRepository.findOne.mockImplementation(
            async ({ where }: { where: { year: number } }) =>
                where.year === 2026
                    ? {
                          year: 2026,
                          opensAt: new Date("2026-12-01T00:00:00.000Z"),
                      }
                    : null,
        );

        await expect(
            service.getCurrentRecap(new Date("2026-11-20T12:00:00.000Z")),
        ).resolves.toMatchObject({ year: 2025, phase: "closed" });
        await expect(
            service.getCurrentRecap(new Date("2026-12-01T00:00:00.000Z")),
        ).resolves.toMatchObject({ year: 2026, phase: "live" });
    });

    it("returns the previous year before the opening", async () => {
        const current = await service.getCurrentRecap(
            new Date("2026-11-10T12:00:00.000Z"),
        );

        expect(current).toMatchObject({
            year: 2025,
            phase: "closed",
            opensAt: new Date("2025-11-15T00:00:00.000Z"),
            closesAt: new Date("2025-12-31T23:59:59.999Z"),
        });
    });

    it("returns the closed year after it ends", async () => {
        const current = await service.getCurrentRecap(
            new Date("2027-01-02T00:00:00.000Z"),
        );

        expect(current).toMatchObject({ year: 2026, phase: "closed" });
    });

    it("caches the edition read for 60 seconds per year", async () => {
        await service.getRecapWindow(2026);

        expect(editionRepository.findOne).toHaveBeenCalledWith({
            where: { year: 2026 },
            cache: {
                id: "recap_edition_2026",
                milliseconds: 60_000,
            },
        });
    });

    it("reports the phase of any year", async () => {
        await expect(
            service.getRecapPhase(2026, new Date("2026-11-10T00:00:00.000Z")),
        ).resolves.toBe("upcoming");
        await expect(
            service.getRecapPhase(2026, new Date("2026-11-15T00:00:00.000Z")),
        ).resolves.toBe("live");
        await expect(
            service.getRecapPhase(2026, new Date("2027-01-01T00:00:00.000Z")),
        ).resolves.toBe("closed");
    });

    it("rejects an opening outside the year without writing", async () => {
        await expect(
            service.setRecapEdition(2026, new Date("2027-01-05T00:00:00.000Z")),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(editionRepository.upsert).not.toHaveBeenCalled();
        expect(queryResultCache.remove).not.toHaveBeenCalled();
    });

    it("stores the opening and clears the 60 s cache", async () => {
        const opensAt = new Date("2026-12-01T00:00:00.000Z");

        await expect(service.setRecapEdition(2026, opensAt)).resolves.toEqual({
            year: 2026,
            opensAt,
            closesAt: new Date("2026-12-31T23:59:59.999Z"),
        });

        expect(editionRepository.upsert).toHaveBeenCalledWith(
            { year: 2026, opensAt },
            ["year"],
        );
        expect(queryResultCache.remove).toHaveBeenCalledWith([
            "recap_edition_2026",
        ]);
    });
});
