import { randomBytes } from "node:crypto";
import { fixtureRuntime } from "./helpers/fixture-runtime";
import { Game } from "../../src/game/game-repository/entities/game.entity";
import { GameVideo } from "../../src/game/game-repository/entities/game-video.entity";
import { GameRepositoryCreateService } from "../../src/game/game-repository/create/game-repository-create.service";
import { ConfigService } from "@nestjs/config";
import { AsyncLeafLimiter } from "../../src/sync/igdb/catalog/async-leaf-limiter";
import { normalizeIgdbGame } from "../../src/sync/igdb/utils/game-conversor-utils";
import { ensureStatisticsTarget } from "../../src/statistics/statistics-target.repository";
import { StatisticsSourceType } from "../../src/statistics/statistics.constants";

it("rolls back a failed video write without advancing the page and retries safely", async () => {
    const runtime = await fixtureRuntime(
        { seed: 42, games: 1 },
        {
            addVideos: true,
            trackPages: false,
            tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
        },
    );
    try {
        const claim = await runtime.state.claimRun();
        await runtime.state.releaseOwnership(claim as any);
        const original = runtime.games.handleOneToMany.bind(runtime.games);
        const fault = jest
            .spyOn(runtime.games, "handleOneToMany")
            .mockImplementation((game, existing, path, context) =>
                path === "videos"
                    ? Promise.reject(new Error("video write fault"))
                    : original(game, existing, path, context),
            );
        await expect(runtime.runner.run(claim!.runId!)).rejects.toThrow(
            "video write fault",
        );
        fault.mockRestore();
        expect(await runtime.state.readStatus()).toMatchObject({
            status: "paused",
            committedId: 0,
        });
        expect(
            await runtime.source.getRepository(Game).countBy({ id: 45 }),
        ).toBe(0);
        expect(await runtime.source.getRepository(GameVideo).count()).toBe(0);
        await runtime.state.resumeRun();
        await runtime.runner.run(claim!.runId!);
        expect(await runtime.state.readStatus()).toMatchObject({
            status: "completed",
            committedId: 45,
        });
        expect(
            await runtime.source.getRepository(GameVideo).countBy({ id: 4500 }),
        ).toBe(1);
        expect(runtime.bounds.maxRelations).toBeLessThanOrEqual(
            runtime.config.relationConcurrency,
        );
        const state = await runtime.state.readStatus();
        await runtime.source.getRepository(GameVideo).delete(4500);
        const override = new GameRepositoryCreateService({
            get: (key: string, fallback: unknown) =>
                key === "IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH"
                    ? "false"
                    : fallback,
        } as ConfigService);
        await runtime.source.transaction((manager) =>
            override.createOrUpdate(
                normalizeIgdbGame({
                    id: 45,
                    name: "Fixture 45",
                    slug: "fixture-45",
                    checksum: "fixture-42-45",
                    videos: [
                        { id: 4500, video_id: "trailer", checksum: "video" },
                    ],
                }),
                {
                    manager,
                    ownershipGuard: async () => undefined,
                    limiter: new AsyncLeafLimiter(2),
                    forceReconciliation: false,
                    ensureStatistics: async (manager, id) => {
                        await ensureStatisticsTarget(
                            manager,
                            StatisticsSourceType.GAME,
                            id,
                        );
                    },
                },
            ),
        );
        expect(
            await runtime.source.getRepository(GameVideo).countBy({ id: 4500 }),
        ).toBe(1);
        expect(await runtime.state.readStatus()).toEqual(state);
    } finally {
        await runtime.queue.obliterate({ force: true });
        await runtime.close();
    }
}, 120000);
