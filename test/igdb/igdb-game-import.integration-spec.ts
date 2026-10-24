import { GameScreenshot } from "../../src/game/game-repository/entities/game-screenshot.entity";
import { DataSource } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { testEnvironment } from "./helpers/test-environment";
import { importEntities } from "./helpers/import-entities";
import { Game } from "../../src/game/game-repository/entities/game.entity";
import { expandedGame } from "../../src/sync/igdb/catalog/fixtures/expanded-game";
import { GameCompanyLogo } from "../../src/game/game-repository/entities/game-company-logo.entity";
import { GameCompany } from "../../src/game/game-repository/entities/game-company.entity";
import { GameCover } from "../../src/game/game-repository/entities/game-cover.entity";
import { GameStatistics } from "../../src/statistics/entity/game-statistics.entity";
import { ensureGameStatistics } from "../../src/statistics/statistics.service";
import { GameRepositoryCreateService } from "../../src/game/game-repository/create/game-repository-create.service";
import { StatisticsQueueService } from "../../src/statistics/statistics-queue/statistics-queue.service";
import { AsyncLeafLimiter } from "../../src/sync/igdb/catalog/async-leaf-limiter";
import { normalizeIgdbGame } from "../../src/sync/igdb/utils/game-conversor-utils";
import { GameImportContext } from "../../src/game/game-repository/create/game-import-context";

describe("transactional game import on isolated MySQL", () => {
    let source: DataSource;
    let service: GameRepositoryCreateService;
    const statisticsQueue = { createStatistics: jest.fn() };
    let logs: jest.SpyInstance;
    beforeAll(async () => {
        logs = jest
            .spyOn(Logger.prototype, "log")
            .mockImplementation(() => undefined);
        source = await new DataSource({
            ...testEnvironment(process.env).mysql,
            timezone: "Z",
            entities: importEntities(),
            synchronize: true,
        }).initialize();
        const reset = source.createQueryRunner();
        try {
            await reset.connect();
            await reset.query("SET FOREIGN_KEY_CHECKS = 0");
            for (const metadata of source.entityMetadatas)
                await reset.query(`TRUNCATE TABLE \`${metadata.tableName}\``);
        } finally {
            await reset.query("SET FOREIGN_KEY_CHECKS = 1");
            await reset.release();
        }
        service = new GameRepositoryCreateService(
            source.getRepository(Game),
            statisticsQueue as unknown as StatisticsQueueService,
            source,
            {
                get: (_key: string, fallback: unknown) => fallback,
            } as ConfigService,
        );
    }, 30_000);
    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        logs?.mockRestore();
    });
    const context = (
        manager: GameImportContext["manager"],
    ): GameImportContext => ({
        manager,
        ownershipGuard: async () => undefined,
        limiter: new AsyncLeafLimiter(2),
        forceReconciliation: true,
        statisticsMode: "transaction",
        ensureStatistics: ensureGameStatistics,
    });

    it("creates forward references atomically, preserves existing metadata and later hydrates", async () => {
        const game = normalizeIgdbGame({
            id: 11001,
            name: "Main",
            slug: "main",
            checksum: "main-checksum",
            dlcs: [
                {
                    id: 11002,
                    name: "Future",
                    slug: "future",
                    checksum: "do-not-copy",
                },
            ],
        });
        await source.transaction((manager) =>
            service.createOrUpdate(game, context(manager)),
        );
        expect(
            await source.getRepository(Game).findOneByOrFail({ id: 11002 }),
        ).toMatchObject({ name: "Future", checksum: null });
        await source
            .getRepository(GameStatistics)
            .update({ gameId: 11002 }, { viewsCount: 8, likesCount: 3 });
        await source.transaction((manager) =>
            service.createOrUpdate(game, context(manager)),
        );
        expect(
            await source
                .getRepository(GameStatistics)
                .countBy({ gameId: 11002 }),
        ).toBe(1);
        expect(
            await source
                .getRepository(GameStatistics)
                .findOneByOrFail({ gameId: 11002 }),
        ).toMatchObject({ viewsCount: 8, likesCount: 3 });
        const full = normalizeIgdbGame({
            id: 11002,
            name: "Hydrated",
            slug: "hydrated",
            checksum: "full-checksum",
            summary: "Complete metadata",
        });
        await source.transaction((manager) =>
            service.createOrUpdate(full, context(manager)),
        );
        await source.transaction((manager) =>
            service.createOrUpdate(game, context(manager)),
        );
        expect(
            await source.getRepository(Game).findOneByOrFail({ id: 11002 }),
        ).toMatchObject({
            name: "Hydrated",
            checksum: "full-checksum",
            summary: "Complete metadata",
        });
        const linked = await source
            .getRepository(Game)
            .findOneOrFail({ where: { id: 11001 }, relations: { dlcs: true } });
        expect(linked.dlcs.map((entry) => Number(entry.id))).toEqual([11002]);
        expect(statisticsQueue.createStatistics).not.toHaveBeenCalled();
    });

    it("rolls back base checksum, image, reference row/statistics and junction after failure", async () => {
        const game = normalizeIgdbGame({
            id: 12001,
            name: "Rollback",
            slug: "rollback",
            checksum: "new",
            cover: { id: 12010, image_id: "fixture", checksum: "image" },
            dlcs: [{ id: 12002, name: "Later", slug: "later" }],
        });
        await source.getRepository(Game).insert({
            id: 12001,
            name: "Before",
            slug: "before",
            checksum: "old",
        });
        await expect(
            source.transaction(async (manager) => {
                const importing = context(manager);
                importing.ensureStatistics = async (transaction, id) => {
                    await ensureGameStatistics(transaction, id);
                    if (id === 12001)
                        throw new Error("injected after relations");
                };
                await service.createOrUpdate(game, importing);
            }),
        ).rejects.toThrow("injected");
        expect(
            await source.getRepository(Game).findOneByOrFail({ id: 12001 }),
        ).toMatchObject({ checksum: "old", name: "Before" });
        expect(await source.getRepository(Game).countBy({ id: 12002 })).toBe(0);
        expect(
            await source.getRepository(GameCover).countBy({ id: 12010 }),
        ).toBe(0);
        expect(
            await source
                .getRepository(GameStatistics)
                .countBy({ gameId: 12002 }),
        ).toBe(0);
        await source.transaction((manager) =>
            service.createOrUpdate(game, context(manager)),
        );
        expect(await source.getRepository(Game).countBy({ id: 12001 })).toBe(1);
    });
    it("uses transaction repositories throughout nested companies/logos/engines and rolls back midway", async () => {
        const game = normalizeIgdbGame(expandedGame(13001));
        const fail = jest
            .spyOn(service, "handleEngines")
            .mockRejectedValueOnce(new Error("nested fault"));
        await expect(
            source.transaction((manager) =>
                service.createOrUpdate(game, context(manager)),
            ),
        ).rejects.toThrow("nested fault");
        fail.mockRestore();
        expect(await source.getRepository(Game).countBy({ id: 13001 })).toBe(0);
        expect(
            await source.getRepository(GameCompany).countBy({ id: 401 }),
        ).toBe(0);
        expect(
            await source.getRepository(GameCompanyLogo).countBy({ id: 402 }),
        ).toBe(0);
        await source.transaction((manager) =>
            service.createOrUpdate(game, context(manager)),
        );
        const stored = await source.getRepository(Game).findOneOrFail({
            where: { id: 13001 },
            relations: {
                involvedCompanies: { company: { logo: true } },
                gameEngines: { platforms: true },
            },
        });
        expect(stored.involvedCompanies[0].company.logo?.id).toBe(402);
        expect(stored.gameEngines[0].platforms[0].id).toBe(301);
    });
    it("rolls back immediately after base upsert", async () => {
        const fault = jest
            .spyOn(service as any, "processRelationships")
            .mockRejectedValueOnce(new Error("after base"));
        try {
            await expect(
                source.transaction((manager) =>
                    service.createOrUpdate(
                        normalizeIgdbGame({
                            id: 14001,
                            name: "Fault",
                            slug: "fault",
                            checksum: "must-rollback",
                        }),
                        context(manager),
                    ),
                ),
            ).rejects.toThrow("after base");
            expect(
                await source.getRepository(Game).countBy({ id: 14001 }),
            ).toBe(0);
        } finally {
            fault.mockRestore();
        }
    });

    it("initializes statistics safely under concurrent inserts and repairs unchanged relations", async () => {
        await source
            .getRepository(Game)
            .insert({ id: 14002, name: "Concurrent", slug: "concurrent" });
        await Promise.all([
            source.transaction((manager) =>
                ensureGameStatistics(manager, 14002),
            ),
            source.transaction((manager) =>
                ensureGameStatistics(manager, 14002),
            ),
        ]);
        expect(
            await source
                .getRepository(GameStatistics)
                .countBy({ gameId: 14002 }),
        ).toBe(1);
        await source.getRepository(GameScreenshot).delete(102);
        await source.transaction((manager) =>
            service.createOrUpdate(
                normalizeIgdbGame(expandedGame(13001)),
                context(manager),
            ),
        );
        expect(
            await source.getRepository(GameScreenshot).countBy({ id: 102 }),
        ).toBe(1);
        expect(statisticsQueue.createStatistics).not.toHaveBeenCalled();
    });
});
