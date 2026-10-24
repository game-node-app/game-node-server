import { EntityManager } from "typeorm";
import { AsyncLeafLimiter } from "../../../sync/igdb/catalog/async-leaf-limiter";
import { ConfigService } from "@nestjs/config";
import { DataSource, Repository } from "typeorm";
import { Game } from "../entities/game.entity";
import { GameRepositoryCreateService } from "./game-repository-create.service";
import { IGDBPartialGame } from "../game-repository.types";
import { StatisticsQueueService } from "../../../statistics/statistics-queue/statistics-queue.service";
import { InvalidGameEntryError } from "./game-import-context";

describe("game import validation", () => {
    const findOne = jest.fn();
    const upsert = jest.fn();
    const service = new GameRepositoryCreateService(
        { findOne, upsert } as unknown as Repository<Game>,
        {} as StatisticsQueueService,
        {} as DataSource,
        { get: (_key: string, fallback: unknown) => fallback } as ConfigService,
    );
    beforeEach(() => {
        findOne.mockClear();
        upsert.mockClear();
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
            service.createOrUpdate(game as IGDBPartialGame),
        ).rejects.toBeInstanceOf(InvalidGameEntryError);
        expect(findOne).not.toHaveBeenCalled();
        expect(upsert).not.toHaveBeenCalled();
    });
    it("preserves valid name and alternative-name legacy inputs", async () => {
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
    it("uses only the supplied manager and initializes statistics without queue jobs", async () => {
        const forbidden = jest.fn(() => {
            throw new Error("default repository escaped");
        });
        const queue = { createStatistics: jest.fn() };
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
        const service = new GameRepositoryCreateService(
            {
                findOne: forbidden,
                upsert: forbidden,
            } as unknown as Repository<Game>,
            queue as unknown as StatisticsQueueService,
            { getRepository: forbidden } as unknown as DataSource,
            {
                get: (_key: string, fallback: unknown) => fallback,
            } as ConfigService,
        );
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
                statisticsMode: "transaction",
            },
        );
        expect(forbidden).not.toHaveBeenCalled();
        expect(ownershipGuard).toHaveBeenCalledWith(manager);
        expect(ensureStatistics).toHaveBeenCalledWith(manager, 1);
        expect(queue.createStatistics).not.toHaveBeenCalled();
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
        const service = new GameRepositoryCreateService(
            repository as unknown as Repository<Game>,
            {} as StatisticsQueueService,
            {} as DataSource,
            {
                get: (_key: string, fallback: unknown) => fallback,
            } as ConfigService,
        );
        const context = {
            manager,
            ownershipGuard: async () => undefined,
            ensureStatistics: jest.fn().mockResolvedValue(undefined),
            limiter: new AsyncLeafLimiter(2),
            forceReconciliation: false,
            statisticsMode: "transaction" as const,
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
