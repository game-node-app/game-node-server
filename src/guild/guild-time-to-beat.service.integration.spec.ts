import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource, Repository } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { IGDBTimeToBeatPlaytime } from "../sync/igdb/igdb.types";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import {
    GUILD_TTB_MAX_BATCH,
    GUILD_TTB_TTL_DAYS,
    GuildTimeToBeatService,
    getEffectiveTtbSeconds,
} from "./guild-time-to-beat.service";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("GuildTimeToBeatService (integration)", () => {
    jest.setTimeout(120000);

    // Unique database so parallel suites never share or wipe the same schema.
    const database = `guild_ttb_test_${randomUUID().slice(0, 8)}`;
    let cleanup: (() => Promise<void>) | undefined;
    let dataSource: DataSource;
    let repository: Repository<GameTimeToBeat>;
    let service: GuildTimeToBeatService;
    const getTimesToBeat = jest.fn();
    let gameSequence = 0;

    const nextGameIds = (count: number) =>
        Array.from({ length: count }, () => 9_500_000_000_000 + ++gameSequence);

    const addGames = async (ids: number[]) => {
        await dataSource.query(
            `INSERT INTO game (id, name, slug) VALUES ${ids
                .map(() => "(?, ?, ?)")
                .join(", ")}`,
            ids.flatMap((id) => [id, `TTB fixture ${id}`, `ttb-fixture-${id}`]),
        );
    };

    const ttb = (
        gameId: number,
        overrides: Partial<IGDBTimeToBeatPlaytime> = {},
    ): IGDBTimeToBeatPlaytime => ({
        id: gameId,
        game_id: gameId,
        hastily: 10_800,
        normally: 21_600,
        completely: 43_200,
        count: 12,
        created_at: 0,
        updated_at: 0,
        checksum: "",
        ...overrides,
    });

    beforeAll(async () => {
        const disposable = await createAwardsTestDatabase(database);
        cleanup = disposable.destroy;
        dataSource = disposable.source;
        repository = dataSource.getRepository(GameTimeToBeat);
        service = new GuildTimeToBeatService(repository, {
            getTimesToBeat,
        } as unknown as IgdbPlaytimeSyncService);
    });

    afterAll(async () => {
        await cleanup?.();
    });

    beforeEach(async () => {
        getTimesToBeat.mockReset();
        await repository.clear();
    });

    it("resolves normally, then hastily, then null", () => {
        expect(
            getEffectiveTtbSeconds({
                normallySeconds: 7_200,
                hastilySeconds: 3_600,
            }),
        ).toBe(7_200);
        expect(
            getEffectiveTtbSeconds({
                normallySeconds: null,
                hastilySeconds: 3_600,
            }),
        ).toBe(3_600);
        expect(
            getEffectiveTtbSeconds({
                normallySeconds: null,
                hastilySeconds: null,
            }),
        ).toBeNull();
        expect(getEffectiveTtbSeconds(null)).toBeNull();
        expect(getEffectiveTtbSeconds(undefined)).toBeNull();
    });

    it("returns an empty map for empty, duplicate or invalid ids", async () => {
        expect((await service.getForGameIds([])).size).toBe(0);
        expect((await service.getForGameIds([0, -1, Number.NaN])).size).toBe(0);
        expect(getTimesToBeat).not.toHaveBeenCalled();
    });

    it("serves a fresh cached row without calling IGDB", async () => {
        const [gameId] = nextGameIds(1);
        await addGames([gameId]);
        await repository.insert({
            gameId,
            hastilySeconds: 3_600,
            normallySeconds: 7_200,
            completelySeconds: 14_400,
            submitCount: 9,
            fetchedAt: new Date("2026-11-01T00:00:00Z"),
        });

        const result = await service.getForGameIds(
            [gameId],
            new Date("2026-11-20T00:00:00Z"),
        );

        expect(getTimesToBeat).not.toHaveBeenCalled();
        expect(result.get(gameId)?.normallySeconds).toBe(7_200);
    });

    it("deduplicates ids and fetches all cache misses in one batch", async () => {
        const [withData, withoutData] = nextGameIds(2);
        await addGames([withData, withoutData]);
        getTimesToBeat.mockResolvedValueOnce([ttb(withData)]);

        const now = new Date("2026-11-21T12:00:00Z");
        const result = await service.getForGameIds(
            [withData, withoutData, withData],
            now,
        );

        expect(getTimesToBeat).toHaveBeenCalledTimes(1);
        expect(getTimesToBeat).toHaveBeenCalledWith([withData, withoutData]);

        const rows = await repository.find({ order: { gameId: "ASC" } });
        expect(rows).toHaveLength(2);
        const positive = rows.find((row) => row.gameId === withData)!;
        expect(positive.normallySeconds).toBe(21_600);
        expect(positive.submitCount).toBe(12);
        const negative = rows.find((row) => row.gameId === withoutData)!;
        expect(negative.normallySeconds).toBeNull();
        expect(negative.hastilySeconds).toBeNull();
        expect(negative.completelySeconds).toBeNull();
        expect(negative.submitCount).toBe(0);
        expect(result.get(withData)?.normallySeconds).toBe(21_600);
        expect(result.get(withoutData)?.normallySeconds).toBeNull();
    });

    it("caps uncached ids at 40 per call", async () => {
        const ids = nextGameIds(GUILD_TTB_MAX_BATCH + 5);
        await addGames(ids);
        getTimesToBeat.mockResolvedValueOnce([]);

        const result = await service.getForGameIds(ids);

        expect(GUILD_TTB_MAX_BATCH).toBe(40);
        expect(getTimesToBeat).toHaveBeenCalledTimes(1);
        const requested = getTimesToBeat.mock.calls[0][0] as number[];
        expect(requested).toHaveLength(GUILD_TTB_MAX_BATCH);
        expect(new Set(requested).size).toBe(GUILD_TTB_MAX_BATCH);
        expect(await repository.count()).toBe(GUILD_TTB_MAX_BATCH);
        expect(result.size).toBe(GUILD_TTB_MAX_BATCH);
    });

    it("caches every returned row of a full batch and only negatively caches the genuine misses", async () => {
        const ids = nextGameIds(GUILD_TTB_MAX_BATCH);
        await addGames(ids);
        const found = ids.slice(0, 35);
        const missing = ids.slice(35);
        getTimesToBeat.mockResolvedValueOnce(found.map((id) => ttb(id)));

        const result = await service.getForGameIds(
            ids,
            new Date("2026-11-21T12:00:00Z"),
        );

        expect(getTimesToBeat).toHaveBeenCalledTimes(1);
        expect(getTimesToBeat).toHaveBeenCalledWith(ids);

        const rows = await repository.find();
        expect(rows).toHaveLength(ids.length);
        for (const id of found) {
            expect(result.get(id)?.normallySeconds).toBe(21_600);
            expect(rows.find((row) => row.gameId === id)?.normallySeconds).toBe(
                21_600,
            );
        }
        for (const id of missing) {
            expect(result.get(id)?.normallySeconds).toBeNull();
            expect(
                rows.find((row) => row.gameId === id)?.normallySeconds,
            ).toBeNull();
            expect(rows.find((row) => row.gameId === id)?.submitCount).toBe(0);
        }
    });

    it("does not refetch a negatively cached game before the TTL expires", async () => {
        const [gameId] = nextGameIds(1);
        await addGames([gameId]);
        getTimesToBeat.mockResolvedValueOnce([]);
        const now = new Date("2026-11-21T12:00:00Z");

        await service.getForGameIds([gameId], now);
        expect(getTimesToBeat).toHaveBeenCalledTimes(1);

        const result = await service.getForGameIds(
            [gameId],
            new Date(now.getTime() + (GUILD_TTB_TTL_DAYS - 1) * DAY_MS),
        );

        expect(getTimesToBeat).toHaveBeenCalledTimes(1);
        expect(result.get(gameId)?.normallySeconds).toBeNull();
    });

    it("refetches and updates a row older than 30 days", async () => {
        const [gameId] = nextGameIds(1);
        await addGames([gameId]);
        await repository.insert({
            gameId,
            hastilySeconds: null,
            normallySeconds: null,
            completelySeconds: null,
            submitCount: 0,
            fetchedAt: new Date("2026-01-01T00:00:00Z"),
        });
        getTimesToBeat.mockResolvedValueOnce([
            ttb(gameId, { hastily: 14_400, normally: 28_800 }),
        ]);
        const now = new Date("2026-11-21T12:00:00Z");

        const result = await service.getForGameIds([gameId], now);

        expect(getTimesToBeat).toHaveBeenCalledWith([gameId]);
        const row = await repository.findOneByOrFail({ gameId });
        expect(row.hastilySeconds).toBe(14_400);
        expect(row.normallySeconds).toBe(28_800);
        expect(row.fetchedAt.getTime()).toBeGreaterThan(now.getTime() - 1_000);
        expect(result.get(gameId)?.normallySeconds).toBe(28_800);
    });

    it("returns cached rows and swallows an upstream IGDB failure", async () => {
        const [cachedId, missingId] = nextGameIds(2);
        await addGames([cachedId, missingId]);
        await repository.insert({
            gameId: cachedId,
            hastilySeconds: 5_400,
            normallySeconds: null,
            completelySeconds: null,
            submitCount: 3,
            fetchedAt: new Date("2026-11-01T00:00:00Z"),
        });
        getTimesToBeat.mockRejectedValueOnce(new Error("IGDB timeout"));

        const result = await service.getForGameIds(
            [cachedId, missingId],
            new Date("2026-11-21T12:00:00Z"),
        );

        expect(getTimesToBeat).toHaveBeenCalledTimes(1);
        expect(result.get(cachedId)?.hastilySeconds).toBe(5_400);
        expect(result.has(missingId)).toBe(false);
        expect(await repository.findOneBy({ gameId: missingId })).toBeNull();
    });
});
