import { IgdbCatalogState } from "../../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import { IgdbDeltaState } from "../../src/sync/igdb/catalog/entities/igdb-delta-state.entity";
import { IGDB_SYNC_ENDPOINTS } from "../../src/sync/igdb/catalog/igdb-sync-endpoints";
import { GameCover } from "../../src/game/game-repository/entities/game-cover.entity";
import { randomBytes } from "node:crypto";
import { fixtureRuntime } from "./helpers/fixture-runtime";
import { Game } from "../../src/game/game-repository/entities/game.entity";
import { normalizeIgdbGame } from "../../src/sync/igdb/utils/game-conversor-utils";
import { IgdbCatalogImportService } from "../../src/sync/igdb/catalog/igdb-catalog-import.service";
import { AsyncLeafLimiter } from "../../src/sync/igdb/catalog/async-leaf-limiter";

it("imports a newly visible game after the completed sweep through the next delta pass", async () => {
    const fixture = {
        seed: 42,
        games: 0,
        updatedAt: Math.floor(Date.now() / 1000) - 120,
    };
    const runtime = await fixtureRuntime(fixture, {
        tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
        trackPages: false,
    });
    try {
        const claim = (await runtime.state.claimRun())!;
        await runtime.state.releaseOwnership(claim as any);
        await runtime.runner.run(claim.runId!);
        expect((await runtime.state.readStatus()).status).toBe("completed");
        expect(await runtime.source.getRepository(Game).count()).toBe(0);
        fixture.games = 1;
        await runtime.delta.run();
        expect(
            await runtime.source
                .getRepository(Game)
                .findOneByOrFail({ id: 45 }),
        ).toMatchObject({
            name: "Fixture 45",
            igdbUpdatedAt: new Date(fixture.updatedAt * 1000),
        });
        expect(await runtime.queue.getWaitingCount()).toBe(0);
        expect(await runtime.queue.getDelayedCount()).toBe(0);
        expect(runtime.bounds.maxGames).toBeLessThanOrEqual(
            runtime.config.gameConcurrency,
        );
        expect(runtime.bounds.maxRelations).toBeLessThanOrEqual(
            runtime.config.relationConcurrency,
        );
    } finally {
        await runtime.queue.obliterate({ force: true });
        await runtime.close();
    }
}, 120000);

it("serializes concurrent sweep/delta game refreshes and preserves the newer source", async () => {
    const runtime = await fixtureRuntime(
        { seed: 42, games: 0 },
        {
            tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
            trackPages: false,
        },
    );
    try {
        const sweep = (await runtime.state.claimRun())!;
        const delta = (await runtime.deltaState.claim())!;
        const importer = new IgdbCatalogImportService(
            runtime.games,
            runtime.state,
        );
        const limiter = new AsyncLeafLimiter(2);
        const old = normalizeIgdbGame({
            id: 45,
            name: "Old",
            slug: "game",
            checksum: "old",
            updated_at: 1700000000,
        });
        const fresh = normalizeIgdbGame({
            id: 45,
            name: "New",
            slug: "game",
            checksum: "new",
            updated_at: 1700000100,
        });
        await importer.persist(
            old,
            (manager) => runtime.state.assertOwnership(manager, sweep as any),
            limiter,
            false,
        );
        await Promise.all([
            importer.persist(
                fresh,
                (manager) =>
                    runtime.deltaState.assertOwnership(manager, delta as any),
                limiter,
                false,
            ),
            importer.persist(
                old,
                (manager) =>
                    runtime.state.assertOwnership(manager, sweep as any),
                limiter,
                false,
            ),
        ]);
        expect(
            await runtime.source
                .getRepository(Game)
                .findOneByOrFail({ id: 45 }),
        ).toMatchObject({
            name: "New",
            checksum: "new",
            igdbUpdatedAt: new Date(1700000100000),
        });
    } finally {
        await runtime.queue.obliterate({ force: true });
        await runtime.close();
    }
}, 120000);

it("refreshes an in-place cover edit, skips matching pages and resumes a sweep endpoint", async () => {
    const runtime = await fixtureRuntime(
        { seed: 42, games: 1 },
        {
            tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
            trackPages: false,
        },
    );
    try {
        const first = (await runtime.state.claimRun())!;
        await runtime.state.releaseOwnership(first as any);
        await runtime.runner.run(first.runId!);
        const fetch = jest.spyOn(runtime.client, "fetchByIds");
        const stateEntity = IgdbCatalogState;
        await runtime.source
            .getRepository(stateEntity)
            .update(1, { nextEligibleAt: new Date(0) });
        const second = (await runtime.state.claimRun())!;
        await runtime.state.releaseOwnership(second as any);
        await runtime.runner.run(second.runId!);
        expect(fetch).not.toHaveBeenCalled();
        await runtime.source.getRepository(stateEntity).update(1, {
            status: "running",
            sweepEndpoint: "covers",
            committedId: 400,
            upperId: 451,
            ownerToken: null,
            leaseExpiresAt: null,
        });
        const sweep = jest
            .spyOn(runtime.client, "fetchSweepPage")
            .mockImplementation(async (entry, cursor) =>
                entry.endpoint === "covers" && cursor < 451
                    ? [{ id: 451, game: 45, checksum: "edited" }]
                    : [],
            );
        const original = fetch.getMockImplementation()!;
        fetch.mockImplementation(async (...args) =>
            (await original.apply(runtime.client, args)).map((game) => ({
                ...game,
                cover: { ...(game.cover as any), checksum: "edited" },
            })),
        );
        await runtime.runner.run(second.runId!);
        expect(sweep.mock.calls[0][1]).toBe(400);
        const coverEntity = GameCover;
        expect(
            await runtime.source.getRepository(coverEntity).findOneOrFail({
                where: { id: 451 },
                relations: { game: true },
            }),
        ).toMatchObject({ checksum: "edited", game: { id: 45 } });
        expect((await runtime.state.readStatus()).status).toBe("completed");
    } finally {
        await runtime.queue.obliterate({ force: true });
        await runtime.close();
    }
}, 120000);

it("skips localized covers without a game and completes the sweep", async () => {
    const runtime = await fixtureRuntime(
        { seed: 42, games: 1 },
        {
            tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
            trackPages: false,
        },
    );
    try {
        const initial = (await runtime.state.claimRun())!;
        await runtime.state.releaseOwnership(initial as any);
        await runtime.runner.run(initial.runId!);
        await runtime.source
            .getRepository(IgdbCatalogState)
            .update(1, { nextEligibleAt: new Date(0) });
        const claim = (await runtime.state.claimRun())!;
        await runtime.state.releaseOwnership(claim as any);
        await runtime.source.getRepository(IgdbCatalogState).update(1, {
            status: "running",
            sweepEndpoint: "covers",
            committedId: 450,
            upperId: 447161,
            ownerToken: null,
            leaseExpiresAt: null,
        });
        const sweep = jest
            .spyOn(runtime.client, "fetchSweepPage")
            .mockImplementation(async (endpoint, cursor) =>
                endpoint.endpoint === "covers" && cursor === 450
                    ? [
                          {
                              id: 451,
                              game_localization: 40272,
                              checksum: "cover-45",
                          },
                          {
                              id: 447161,
                              game_localization: 40272,
                              checksum: "localized-cover",
                          },
                      ]
                    : [],
            );
        const fetch = jest.spyOn(runtime.client, "fetchByIds");

        await runtime.runner.run(claim.runId!);

        expect(
            sweep.mock.calls.some(
                ([endpoint, cursor]) =>
                    endpoint.endpoint === "covers" && cursor === 450,
            ),
        ).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
        expect((await runtime.state.readStatus()).status).toBe("completed");
    } finally {
        await runtime.queue.obliterate({ force: true });
        await runtime.close();
    }
}, 120000);

it("fills a compared field even with an unchanged game checksum", async () => {
    const runtime = await fixtureRuntime(
        { seed: 42, games: 1 },
        {
            tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
            trackPages: false,
        },
    );
    const endpoints = IGDB_SYNC_ENDPOINTS;
    const games = endpoints[0];
    try {
        const claim = (await runtime.state.claimRun())!;
        await runtime.state.releaseOwnership(claim as any);
        await runtime.runner.run(claim.runId!);
        const stateEntity = IgdbCatalogState;
        await runtime.source
            .getRepository(stateEntity)
            .update(1, { nextEligibleAt: new Date(0) });
        const next = (await runtime.state.claimRun())!;
        await runtime.state.releaseOwnership(next as any);
        games.compare.push({ source: "game_type", column: "category" });
        jest.spyOn(runtime.client, "fetchSweepPage").mockImplementation(
            async (entry, cursor) =>
                entry.endpoint === "games" && cursor === 0
                    ? [{ id: 45, checksum: "fixture-42-45", game_type: 1 }]
                    : [],
        );
        const original = runtime.client.fetchByIds.bind(runtime.client);
        const fetch = jest
            .spyOn(runtime.client, "fetchByIds")
            .mockImplementation(async (...args) =>
                (await original.apply(runtime.client, args)).map((game) => ({
                    ...game,
                    game_type: 1,
                })),
            );
        await runtime.runner.run(next.runId!);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(
            await runtime.source
                .getRepository(Game)
                .findOneByOrFail({ id: 45 }),
        ).toMatchObject({ category: 1, checksum: "fixture-42-45" });
    } finally {
        games.compare.length = 0;
        await runtime.queue.obliterate({ force: true });
        await runtime.close();
    }
}, 120000);

it("fences shared-entity writes and page checkpoints after delta takeover", async () => {
    const runtime = await fixtureRuntime(
        { seed: 42, games: 0 },
        {
            tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
            trackPages: false,
        },
    );
    const entries = IGDB_SYNC_ENDPOINTS;
    const genres = entries.find((entry) => entry.endpoint === "genres")!;
    const stateEntity = IgdbDeltaState;
    try {
        await runtime.source
            .getRepository(genres.local.entity)
            .save({ id: 1, name: "Before", slug: "genre", checksum: "old" });
        const old = (await runtime.deltaState.claim())!;
        await runtime.deltaState.window(old as any, "genres", 7);
        await runtime.source
            .getRepository(stateEntity)
            .update("lease", { leaseExpiresAt: new Date(0) });
        expect(await runtime.deltaState.claim()).toBeTruthy();
        await expect(
            runtime.refresh.apply(
                genres,
                [{ id: 1, name: "After", checksum: "new" }],
                (manager) =>
                    runtime.deltaState.assertOwnership(manager, old as any),
                new AsyncLeafLimiter(2),
                false,
                true,
            ),
        ).rejects.toThrow("ownership");
        expect(
            await runtime.source
                .getRepository(genres.local.entity)
                .findOneByOrFail({ id: 1 }),
        ).toMatchObject({ name: "Before", checksum: "old" });
        await expect(
            runtime.deltaState.checkpoint(old as any, "genres", 0, 1),
        ).rejects.toThrow("ownership");
        expect(
            await runtime.source
                .getRepository(stateEntity)
                .findOneByOrFail({ stream: "genres" }),
        ).toMatchObject({ cursor: 0 });
    } finally {
        await runtime.queue.obliterate({ force: true });
        await runtime.close();
    }
}, 120000);
