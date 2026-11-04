import "reflect-metadata";
import { DataSource } from "typeorm";
import { IgdbDeltaState } from "../../src/sync/igdb/catalog/entities/igdb-delta-state.entity";
import { IgdbCatalogState } from "../../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import {
    IgdbDeltaStateService,
    DELTA_TIMING,
} from "../../src/sync/igdb/catalog/igdb-delta-state.service";
import { IgdbCatalogStateService } from "../../src/sync/igdb/catalog/igdb-catalog-state.service";
import { testEnvironment } from "./helpers/test-environment";

describe("delta durable state", () => {
    let source: DataSource;
    let service: IgdbDeltaStateService;
    beforeAll(async () => {
        source = await new DataSource({
            ...testEnvironment(process.env).mysql,
            timezone: "Z",
            entityPrefix: "delta_test_",
            entities: [IgdbDeltaState, IgdbCatalogState],
            synchronize: true,
        }).initialize();
        service = new IgdbDeltaStateService(source);
    });
    beforeEach(async () => {
        await source.getRepository(IgdbDeltaState).clear();
        await source.getRepository(IgdbCatalogState).clear();
        await source.getRepository(IgdbDeltaState).save({ stream: "lease" });
        await source.getRepository(IgdbCatalogState).save({ id: 1 });
    });
    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
    });

    it.each(["completed", "running"] as const)(
        "seeds from the latest %s sweep startedAt minus overlap",
        async (status) => {
            const startedAt = new Date("2026-10-30T21:45:00Z");
            await source
                .getRepository(IgdbCatalogState)
                .update(1, { status, startedAt });
            const owner = (await service.claim())!;
            const window = (await service.window(owner as any, "games", 7))!;
            expect(window.watermark).toEqual(startedAt);
            expect(+window.windowStart!).toBe(
                +startedAt - DELTA_TIMING.overlapMs,
            );
            await service.checkpoint(owner as any, "games", 0, 42);
            const resumed = (await service.window(owner as any, "games", 7))!;
            expect(resumed).toMatchObject({
                cursor: 42,
                windowStart: window.windowStart,
                windowEnd: window.windowEnd,
                watermark: startedAt,
            });
            await service.checkpoint(owner as any, "games", 42, null);
            expect(
                await source
                    .getRepository(IgdbDeltaState)
                    .findOneByOrFail({ stream: "games" }),
            ).toMatchObject({
                watermark: window.windowEnd,
                windowStart: null,
                windowEnd: null,
            });
        },
    );
    it("uses now minus interval when startedAt is null and preserves paused windows", async () => {
        const owner = (await service.claim())!;
        const window = (await service.window(owner as any, "games", 14))!;
        expect(
            Math.abs(+window.watermark! - (Date.now() - 14 * 86400000)),
        ).toBeLessThan(5000);
        await service.pause(owner as any, "games", "fetch: source unavailable");
        expect(await service.window(owner as any, "games", 14)).toBeNull();
        expect(
            await source
                .getRepository(IgdbDeltaState)
                .findOneByOrFail({ stream: "games" }),
        ).toMatchObject({
            watermark: window.watermark,
            windowEnd: window.windowEnd,
        });
    });
    it("fences takeover, injected transactions and checkpoints", async () => {
        const old = (await service.claim())!;
        expect(await service.claim()).toBeNull();
        await service.window(old as any, "games", 7);
        await source
            .getRepository(IgdbDeltaState)
            .update("lease", { leaseExpiresAt: new Date(0) });
        const owner = (await service.claim())!;
        expect(owner.ownerGeneration).toBe(old.ownerGeneration + 1);
        await expect(
            service.checkpoint(old as any, "games", 0, 42),
        ).rejects.toThrow("ownership");
        const work = jest.fn();
        const transactions = new IgdbCatalogStateService(source);
        await expect(
            transactions.gameTransaction(
                (manager) => service.assertOwnership(manager, old as any),
                work,
            ),
        ).rejects.toThrow("ownership");
        expect(work).not.toHaveBeenCalled();
        await transactions.gameTransaction(
            (manager) => service.assertOwnership(manager, owner as any),
            async (manager) => {
                await manager.update(IgdbDeltaState, "games", { cursor: 7 });
            },
        );
        await service.release(owner as any);
        expect(await service.claim()).toBeNull();
    });
});
