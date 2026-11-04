import { GameVideo } from "../../src/game/game-repository/entities/game-video.entity";
import { GameRepositoryService } from "../../src/game/game-repository/game-repository.service";
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
import { StatisticsSourceType } from "../../src/statistics/statistics.constants";
import { ensureStatisticsTarget } from "../../src/statistics/statistics-target.repository";
import { GameRepositoryCreateService } from "../../src/game/game-repository/create/game-repository-create.service";
import { AsyncLeafLimiter } from "../../src/sync/igdb/catalog/async-leaf-limiter";
import { normalizeIgdbGame } from "../../src/sync/igdb/utils/game-conversor-utils";
import { GameImportContext } from "../../src/game/game-repository/create/game-import-context";

describe("transactional game import on isolated MySQL", () => {
    let source: DataSource;
    let service: GameRepositoryCreateService;
    let logs: jest.SpyInstance;
    beforeAll(async () => {
        logs = jest
            .spyOn(Logger.prototype, "log")
            .mockImplementation(() => undefined);
        source = await new DataSource({
            ...testEnvironment(process.env).mysql,
            timezone: "Z",
            entityPrefix: "gi_",
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
        service = new GameRepositoryCreateService({
            get: (_key: string, fallback: unknown) => fallback,
        } as ConfigService);
    }, 30_000);
    afterAll(async () => {
        if (source?.isInitialized) {
            const cleanup = source.createQueryRunner();
            try {
                await cleanup.connect();
                await cleanup.query("SET FOREIGN_KEY_CHECKS = 0");
                for (const metadata of source.entityMetadatas)
                    await cleanup.query(
                        `DROP TABLE IF EXISTS \`${metadata.tableName}\``,
                    );
            } finally {
                await cleanup.query("SET FOREIGN_KEY_CHECKS = 1");
                await cleanup.release();
                await source.destroy();
            }
        }
        logs?.mockRestore();
    });
    const context = (
        manager: GameImportContext["manager"],
    ): GameImportContext => ({
        manager,
        ownershipGuard: async () => undefined,
        limiter: new AsyncLeafLimiter(2),
        forceReconciliation: true,
        ensureStatistics: async (manager, gameId) => {
            await ensureStatisticsTarget(
                manager,
                StatisticsSourceType.GAME,
                gameId,
            );
        },
    });

    it("registers both sides of the video relation", () => {
        expect(
            source.getMetadata(GameVideo).relations[0].inverseEntityMetadata
                .target,
        ).toBe(Game);
        expect(
            source
                .getMetadata(Game)
                .relations.find(
                    (relation) => relation.propertyName === "videos",
                )?.inverseEntityMetadata.target,
        ).toBe(GameVideo);
    });

    it("imports, replays and reconciles video metadata without changing statistics", async () => {
        const raw = {
            id: 15001,
            name: "Video game",
            slug: "video-game",
            checksum: "same",
            videos: [
                {
                    id: 15010,
                    game: 15001,
                    name: "Trailer",
                    video_id: "first",
                    checksum: "one",
                },
            ],
        };
        const save = (data: Record<string, unknown>, force = true) =>
            source.transaction((manager) =>
                service.createOrUpdate(normalizeIgdbGame(data), {
                    ...context(manager),
                    forceReconciliation: force,
                    reconcileRelations: true,
                }),
            );
        await save(raw);
        const targetId = (
            await source.getRepository(Game).findOneByOrFail({ id: 15001 })
        ).statisticsTargetId;
        await source.query(
            "INSERT INTO gi_metric_total (targetId, metricCode, metricValue) VALUES (?, 'views', 7)",
            [targetId],
        );
        await save(raw);
        expect(
            await source.getRepository(GameVideo).countBy({ id: 15010 }),
        ).toBe(1);
        let video = await source
            .getRepository(GameVideo)
            .findOneOrFail({ where: { id: 15010 }, relations: { game: true } });
        expect(video).toMatchObject({
            game: { id: 15001 },
            videoId: "first",
            url: "https://www.youtube.com/watch?v=first",
        });
        await save({
            ...raw,
            videos: [
                { id: 15010, name: "New", video_id: "a&b", checksum: "two" },
            ],
        });
        video = await source
            .getRepository(GameVideo)
            .findOneByOrFail({ id: 15010 });
        expect(video).toMatchObject({
            name: "New",
            checksum: "two",
            url: "https://www.youtube.com/watch?v=a%26b",
        });
        await save({ ...raw, videos: [{ id: 15010, checksum: "three" }] });
        expect(
            await source
                .getRepository(GameVideo)
                .findOneByOrFail({ id: 15010 }),
        ).toMatchObject({ videoId: null, url: null });
        expect(
            await source.query(
                "SELECT metricValue FROM gi_metric_total WHERE targetId = ? AND metricCode = 'views'",
                [targetId],
            ),
        ).toMatchObject([{ metricValue: 7 }]);
        await source.getRepository(GameVideo).delete(15010);
        await save(raw);
        expect(
            await source.getRepository(GameVideo).countBy({ id: 15010 }),
        ).toBe(1);
        await source.getRepository(GameVideo).delete(15010);
        const clock = jest.spyOn(Date, "now").mockReturnValue(604800000);
        try {
            await save(raw, false);
            expect(
                await source.getRepository(GameVideo).countBy({ id: 15010 }),
            ).toBe(1);
        } finally {
            clock.mockRestore();
        }
    });

    it("retains absent videos and rolls back a failed video write for retry", async () => {
        const raw = {
            id: 16001,
            name: "Before",
            slug: "retention",
            checksum: "one",
            videos: [
                { id: 16010, checksum: "a" },
                { id: 16011, checksum: "b" },
            ],
        };
        const save = (data: Record<string, unknown>) =>
            source.transaction((manager) =>
                service.createOrUpdate(
                    normalizeIgdbGame(data),
                    context(manager),
                ),
            );
        await save(raw);
        for (const videos of [
            undefined,
            null,
            [],
            [{ id: 16010, checksum: "a" }],
        ]) {
            await save({ ...raw, videos });
            expect(
                await source
                    .getRepository(GameVideo)
                    .countBy({ game: { id: 16001 } }),
            ).toBe(2);
        }
        const original = service.handleOneToMany.bind(service);
        const failure = jest
            .spyOn(service, "handleOneToMany")
            .mockImplementation((incoming, existing, path, ctx) =>
                path === "videos"
                    ? Promise.reject(new Error("video fault"))
                    : original(incoming, existing, path, ctx),
            );
        try {
            await expect(
                save({ ...raw, name: "After", checksum: "two" }),
            ).rejects.toThrow("video fault");
        } finally {
            failure.mockRestore();
        }
        expect(
            await source.getRepository(Game).findOneByOrFail({ id: 16001 }),
        ).toMatchObject({ name: "Before", checksum: "one" });
        await save({ ...raw, name: "After", checksum: "two" });
        expect(
            await source.getRepository(Game).findOneByOrFail({ id: 16001 }),
        ).toMatchObject({ name: "After", checksum: "two" });
        expect(
            await source
                .getRepository(GameVideo)
                .countBy({ game: { id: 16001 } }),
        ).toBe(2);
    });

    it("loads videos through the existing single, multiple and resource queries", async () => {
        await source.transaction((manager) =>
            service.createOrUpdate(
                normalizeIgdbGame({
                    id: 17001,
                    name: "Videos",
                    slug: "videos",
                    checksum: "one",
                    videos: [
                        { id: 17010, video_id: "trailer", checksum: "one" },
                    ],
                }),
                context(manager),
            ),
        );
        await source.transaction((manager) =>
            service.createOrUpdate(
                normalizeIgdbGame({
                    id: 17002,
                    name: "No videos",
                    slug: "no-videos",
                    checksum: "one",
                }),
                context(manager),
            ),
        );
        const repository = new GameRepositoryService(
            source,
            null as any,
            null as any,
            source.getRepository(Game),
            null as any,
        );
        const one = await repository.findOneByIdOrFail(17001, {
            relations: { videos: true },
        });
        expect(one.videos).toMatchObject([
            {
                id: 17010,
                videoId: "trailer",
                url: "https://www.youtube.com/watch?v=trailer",
            },
        ]);
        expect(
            (await repository.findOneByIdOrFail(17001)).videos,
        ).toBeUndefined();
        const many = await repository.findAllByIds({
            gameIds: [17001, 17002],
            relations: { videos: true },
        });
        expect(many[0].videos).toHaveLength(1);
        expect(many[1].videos).toEqual([]);
        expect(await repository.getResource("videos")).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 17010 })]),
        );
    });

    it("creates forward references atomically, preserves existing metadata and later hydrates", async () => {
        await source.query(
            "ALTER TABLE gi_game MODIFY statisticsTargetId BIGINT UNSIGNED NOT NULL",
        );
        try {
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
            const targetRows = await source.query(
                "SELECT statisticsTargetId FROM gi_game WHERE id = ?",
                [11002],
            );
            const targetId = Number(targetRows[0].statisticsTargetId);
            await source.query(
                "INSERT INTO gi_metric_total (targetId, metricCode, metricValue) VALUES (?, 'views', 8)",
                [targetId],
            );
            await source.query(
                "UPDATE gi_metric_total SET metricValue = 3 WHERE targetId = ? AND metricCode = 'likes_current'",
                [targetId],
            );
            await source.transaction((manager) =>
                service.createOrUpdate(game, context(manager)),
            );
            expect(
                await source.query(
                    "SELECT id FROM gi_statistics_target WHERE id = ?",
                    [targetId],
                ),
            ).toHaveLength(1);
            expect(
                await source.query(
                    "SELECT metricCode, metricValue FROM gi_metric_total WHERE targetId = ? ORDER BY metricCode",
                    [targetId],
                ),
            ).toEqual([
                { metricCode: "likes_current", metricValue: 3 },
                { metricCode: "views", metricValue: 8 },
            ]);
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
            const linked = await source.getRepository(Game).findOneOrFail({
                where: { id: 11001 },
                relations: { dlcs: true },
            });
            expect(linked.dlcs.map((entry) => Number(entry.id))).toEqual([
                11002,
            ]);
        } finally {
            await source.query(
                "ALTER TABLE gi_game MODIFY statisticsTargetId BIGINT UNSIGNED NULL",
            );
        }
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
                    await ensureStatisticsTarget(
                        transaction,
                        StatisticsSourceType.GAME,
                        id,
                    );
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
            await source.query(
                "SELECT id FROM gi_statistics_target WHERE id IN (SELECT statisticsTargetId FROM gi_game WHERE id = 12002)",
            ),
        ).toHaveLength(0);
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
                ensureStatisticsTarget(
                    manager,
                    StatisticsSourceType.GAME,
                    14002,
                ),
            ),
            source.transaction((manager) =>
                ensureStatisticsTarget(
                    manager,
                    StatisticsSourceType.GAME,
                    14002,
                ),
            ),
        ]);
        expect(
            await source.query(
                "SELECT statisticsTargetId FROM gi_game WHERE id = 14002 AND statisticsTargetId IS NOT NULL",
            ),
        ).toHaveLength(1);
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
    });
});
