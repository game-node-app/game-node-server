import { EntityManager } from "typeorm";
import { AsyncLeafLimiter } from "../../../sync/igdb/catalog/async-leaf-limiter";
import { ConfigService } from "@nestjs/config";
import { GameRepositoryCreateService } from "./game-repository-create.service";
import { IGDBPartialGame } from "../game-repository.types";
import {
    GameImportContext,
    InvalidGameEntryError,
} from "./game-import-context";

jest.mock("../../../statistics/statistics-target.repository", () => ({
    createStatisticsTarget: jest.fn().mockResolvedValue(1),
}));

describe("game import validation", () => {
    const getRepository = jest.fn();
    const service = new GameRepositoryCreateService({
        get: (_key: string, fallback: unknown) => fallback,
    } as ConfigService);
    const context = {
        manager: { getRepository },
        ownershipGuard: jest.fn().mockResolvedValue(undefined),
        ensureStatistics: jest.fn().mockResolvedValue(undefined),
        limiter: new AsyncLeafLimiter(2),
        forceReconciliation: false,
    } as unknown as GameImportContext;
    beforeEach(() => {
        getRepository.mockClear();
    });
    it.each([
        {},
        { id: "1", name: "Name" },
        { id: NaN, name: "Name" },
        { id: -1, name: "Name" },
        { id: 1.5, name: "Name" },
        { id: 0, name: "Name" },
        { id: 1 },
        { id: 1, name: " ", alternativeNames: [] },
        { id: 1, alternativeNames: [{}] },
    ])("fails before repository access for %j", async (game) => {
        await expect(
            service.createOrUpdate(game as IGDBPartialGame, context),
        ).rejects.toBeInstanceOf(InvalidGameEntryError);
        expect(getRepository).not.toHaveBeenCalled();
    });
    it("preserves valid name and alternative-name inputs", async () => {
        expect(
            await service.isValidEntry({
                id: 1,
                name: "Name",
            } as IGDBPartialGame),
        ).toBe(true);
        expect(
            await service.isValidEntry({
                id: 1,
                alternativeNames: [{ name: "Alternate" }],
            } as IGDBPartialGame),
        ).toBe(true);
    });
});

describe("transaction-scoped repositories", () => {
    it("uses the supplied manager and initializes statistics in its transaction", async () => {
        const repository = {
            findOne: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
            findOneOrFail: jest.fn().mockResolvedValue({ id: 1 }),
        };
        const manager = {
            getRepository: jest.fn().mockReturnValue(repository),
        } as unknown as EntityManager;
        const ownershipGuard = jest.fn().mockResolvedValue(undefined);
        const ensureStatistics = jest.fn().mockResolvedValue(undefined);
        const service = new GameRepositoryCreateService({
            get: (_key: string, fallback: unknown) => fallback,
        } as ConfigService);
        await service.createOrUpdate(
            {
                id: 1,
                name: "Fixture",
                slug: "fixture",
                checksum: "checksum",
            } as IGDBPartialGame,
            {
                manager,
                ownershipGuard,
                ensureStatistics,
                limiter: new AsyncLeafLimiter(2),
                forceReconciliation: true,
            },
        );
        expect(manager.getRepository).toHaveBeenCalled();
        expect(ownershipGuard).toHaveBeenCalledWith(manager);
        expect(ensureStatistics).toHaveBeenCalledWith(manager, 1);
    });
});

describe("forced versus ordinary relationship reconciliation", () => {
    it("forces unchanged games while retaining checksum skip and weekly buckets", async () => {
        const clock = jest.spyOn(Date, "now").mockReturnValue(0);
        const repository = {
            findOne: jest.fn().mockResolvedValue({ id: 1, checksum: "same" }),
            findOneOrFail: jest.fn().mockResolvedValue({ id: 1 }),
            upsert: jest.fn(),
        };
        const manager = {
            getRepository: () => repository,
        } as unknown as EntityManager;
        const service = new GameRepositoryCreateService({
            get: (_key: string, fallback: unknown) => fallback,
        } as ConfigService);
        const context = {
            manager,
            ownershipGuard: async () => undefined,
            ensureStatistics: jest.fn().mockResolvedValue(undefined),
            limiter: new AsyncLeafLimiter(2),
            forceReconciliation: false,
        };
        try {
            await service.createOrUpdate(
                { id: 1, name: "Same", checksum: "same" } as IGDBPartialGame,
                context,
            );
            expect(repository.findOneOrFail).not.toHaveBeenCalled();
            await service.createOrUpdate(
                { id: 1, name: "Same", checksum: "same" } as IGDBPartialGame,
                { ...context, forceReconciliation: true },
            );
            expect(repository.findOneOrFail).toHaveBeenCalledTimes(1);
            await service.createOrUpdate(
                { id: 4, name: "Bucket", checksum: "same" } as IGDBPartialGame,
                context,
            );
            expect(repository.findOneOrFail).toHaveBeenCalledTimes(2);
            expect(repository.upsert).not.toHaveBeenCalled();
            expect(context.ensureStatistics).toHaveBeenCalledTimes(3);
        } finally {
            clock.mockRestore();
        }
    });
});
