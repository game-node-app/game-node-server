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
    it("reconciles unchanged games only when requested", async () => {
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
                { ...context, reconcileRelations: true },
            );
            expect(repository.findOneOrFail).toHaveBeenCalledTimes(1);
            await service.createOrUpdate(
                { id: 4, name: "Bucket", checksum: "same" } as IGDBPartialGame,
                context,
            );
            expect(repository.findOneOrFail).toHaveBeenCalledTimes(1);
            expect(repository.upsert).toHaveBeenCalledTimes(1);
            expect(context.ensureStatistics).toHaveBeenCalledTimes(3);
        } finally {
            clock.mockRestore();
        }
    });
});

describe("external game reconciliation ignores GameNode-owned rows", () => {
    function run(existingRows: any[], incoming: any[]) {
        const addAndRemove = jest.fn();
        const repository = {
            create: (value: unknown) => value,
            upsert: jest.fn(),
            createQueryBuilder: () => ({
                relation: () => ({ of: () => ({ addAndRemove }) }),
            }),
        };
        const context = {
            manager: {
                getRepository: () => repository,
                connection: { getMetadata: () => ({ target: Object }) },
            },
            limiter: new AsyncLeafLimiter(2),
            forceReconciliation: false,
        } as unknown as GameImportContext;
        const service = new GameRepositoryCreateService({
            get: (_key: string, fallback: unknown) => fallback,
        } as ConfigService);
        return service
            .handleManyToMany(
                { id: 1, externalGames: incoming } as IGDBPartialGame,
                { id: 1, externalGames: existingRows } as any,
                "externalGames",
                context,
            )
            .then(() => ({ addAndRemove, repository }));
    }

    it("upserts IGDB rows without detaching rows IGDB dropped", async () => {
        const { addAndRemove, repository } = await run(
            [
                { id: 10, checksum: "a", origin: "igdb" },
                { id: 1e12, checksum: null, origin: "curated" },
            ],
            [{ id: 11, checksum: "b" }],
        );
        expect(repository.upsert).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 11, gameId: 1 })],
            ["id"],
        );
        // Detaching sets the NOT NULL gameId to NULL and fails in MySQL.
        expect(addAndRemove).not.toHaveBeenCalled();
    });

    it("does not reconcile when only a curated row differs", async () => {
        const { addAndRemove, repository } = await run(
            [
                { id: 10, checksum: "a", origin: "igdb" },
                { id: 1e12, checksum: null, origin: "bulk" },
            ],
            [{ id: 10, checksum: "a" }],
        );
        expect(repository.upsert).not.toHaveBeenCalled();
        expect(addAndRemove).not.toHaveBeenCalled();
    });
});

describe("IGDB source recency", () => {
    it.each([
        [-1, true],
        [0, false],
        [1, false],
        [null, false],
    ])("incoming offset %s skips writes: %s", async (offset, stale) => {
        const timestamp = new Date("2026-11-01T00:00:00Z");
        const repository = {
            findOne: jest.fn().mockResolvedValue({
                id: 1,
                checksum: "old",
                statisticsTargetId: 1,
                igdbUpdatedAt: timestamp,
            }),
            upsert: jest.fn(),
            findOneOrFail: jest.fn().mockResolvedValue({ id: 1 }),
        };
        const ensureStatistics = jest.fn();
        const service = new GameRepositoryCreateService({
            get: (_: string, fallback: unknown) => fallback,
        } as ConfigService);
        await service.createOrUpdate(
            {
                id: 1,
                name: "Game",
                checksum: "new",
                updatedAt:
                    offset === null
                        ? null
                        : new Date(+timestamp + offset * 1000),
            } as any,
            {
                manager: { getRepository: () => repository } as any,
                ownershipGuard: async () => undefined,
                ensureStatistics,
                limiter: new AsyncLeafLimiter(2),
                forceReconciliation: false,
            },
        );
        expect(repository.upsert).toHaveBeenCalledTimes(stale ? 0 : 1);
        expect(repository.findOneOrFail).toHaveBeenCalledTimes(stale ? 0 : 1);
        expect(ensureStatistics).toHaveBeenCalledTimes(stale ? 0 : 1);
        if (!stale)
            expect(repository.upsert.mock.calls[0][0].igdbUpdatedAt).toEqual(
                offset === null
                    ? timestamp
                    : new Date(+timestamp + offset * 1000),
            );
    });

    it("refreshes a changed localization with unchanged game checksum and writes no unchanged relationships", async () => {
        const localizations = [{ id: 10, checksum: "old" }];
        const relationshipRepository = {
            create: (row: unknown) => row,
            upsert: jest.fn(),
        };
        const repository = {
            findOne: jest.fn().mockResolvedValue({ id: 1, checksum: "same" }),
            findOneOrFail: jest
                .fn()
                .mockResolvedValue({ id: 1, gameLocalizations: localizations }),
            upsert: jest.fn(),
        };
        const service = new GameRepositoryCreateService({
            get: (_: string, fallback: unknown) => fallback,
        } as ConfigService);
        const context = {
            manager: {
                getRepository: (entity: any) =>
                    entity.name === "Game"
                        ? repository
                        : relationshipRepository,
            },
            ownershipGuard: async () => undefined,
            ensureStatistics: async () => undefined,
            limiter: new AsyncLeafLimiter(2),
            forceReconciliation: false,
            reconcileRelations: true,
        } as unknown as GameImportContext;
        const game = {
            id: 1,
            name: "Game",
            checksum: "same",
            gameLocalizations: [{ id: 10, checksum: "new" }],
        } as any;
        await service.createOrUpdate(game, context);
        expect(relationshipRepository.upsert).toHaveBeenCalledTimes(1);
        localizations[0].checksum = "new";
        relationshipRepository.upsert.mockClear();
        await service.createOrUpdate(game, context);
        expect(relationshipRepository.upsert).not.toHaveBeenCalled();
    });
});

it("does not write unchanged engine platforms or links during reconciliation", async () => {
    const service = new GameRepositoryCreateService({
        get: (_: string, fallback: unknown) => fallback,
    } as ConfigService);
    jest.spyOn(service, "handleManyToMany").mockResolvedValue(undefined);
    const repo = { upsert: jest.fn(), createQueryBuilder: jest.fn() };
    const engine = {
        id: 1,
        checksum: "same",
        platforms: [{ id: 2, checksum: "same" }],
    };
    await service.handleEngines(
        { id: 1, gameEngines: [engine] } as any,
        { id: 1, gameEngines: [engine] } as any,
        {
            manager: { getRepository: () => repo },
            limiter: new AsyncLeafLimiter(2),
            forceReconciliation: false,
        } as unknown as GameImportContext,
    );
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
});
