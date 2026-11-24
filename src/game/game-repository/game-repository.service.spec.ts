import { BadRequestException } from "@nestjs/common";
import { minutes } from "@nestjs/throttler";
import { GameRepositoryService } from "./game-repository.service";
import {
    FindGamesByCollectionTypeRequestDto,
    GameRepositoryCollectionType,
} from "./dto/game-repository-collection.dto";
import { Game } from "./entities/game.entity";
import { MATURE_THEME_ID } from "../game-filter/game-filter.constants";

const game = (id: number, extra: Partial<Game> = {}) =>
    ({ id, name: `Game ${id}`, ...extra }) as Game;

type CacheStub = {
    get: jest.Mock;
    set: jest.Mock;
    mget: jest.Mock;
    mset: jest.Mock;
};

function cacheStub(): CacheStub {
    return {
        get: jest.fn(async () => null),
        set: jest.fn(async () => undefined),
        mget: jest.fn(async () => []),
        mset: jest.fn(async () => []),
    };
}

function createService(gameRepository: object, cache: object) {
    return new GameRepositoryService(
        {} as never,
        {} as never,
        {} as never,
        gameRepository as never,
        cache as never,
    );
}

function fixture(rawRows: unknown[]) {
    const getRawMany = jest.fn(async () => rawRows);
    const queryBuilder: any = {
        innerJoin: jest.fn(() => queryBuilder),
        select: jest.fn(() => queryBuilder),
        addSelect: jest.fn(() => queryBuilder),
        where: jest.fn(() => queryBuilder),
        getRawMany,
    };

    const service = createService(
        { createQueryBuilder: jest.fn(() => queryBuilder) },
        {},
    );

    return { service, queryBuilder };
}

function collectionFixture(result: [Game[], number] = [[], 0]) {
    const query: Record<string, jest.Mock> = {};
    for (const method of [
        "select",
        "where",
        "andWhere",
        "leftJoin",
        "addSelect",
        "leftJoinAndSelect",
        "orderBy",
        "skip",
        "take",
    ]) {
        query[method] = jest.fn(() => query);
    }
    query.getManyAndCount = jest.fn(async () => result);

    const gameRepository = { createQueryBuilder: jest.fn(() => query) };
    const cache = cacheStub();
    const service = createService(gameRepository, cache);

    return { service, query, cache, gameRepository };
}

function collectionDto(
    overrides: Partial<FindGamesByCollectionTypeRequestDto> = {},
): FindGamesByCollectionTypeRequestDto {
    return {
        collectionType: GameRepositoryCollectionType.UPCOMING,
        ...overrides,
    };
}

const findBound = (query: Record<string, jest.Mock>, operator: string) => {
    const call = query.andWhere.mock.calls.find(([sql]) =>
        sql.includes(operator),
    );
    return call?.[1];
};

describe("GameRepositoryService.findGameGenresByIds", () => {
    it("selects only the game and genre fields through the genres relation", async () => {
        const { service, queryBuilder } = fixture([
            { gameId: "1", genreId: "10", genreName: "RPG" },
        ]);

        const rows = await service.findGameGenresByIds([1, 2]);

        expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
            "game.genres",
            "genre",
        );
        expect(queryBuilder.select).toHaveBeenCalledWith("game.id", "gameId");
        expect(queryBuilder.addSelect).toHaveBeenCalledTimes(2);
        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
            "genre.id",
            "genreId",
        );
        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
            "genre.name",
            "genreName",
        );
        expect(queryBuilder.where).toHaveBeenCalledWith(
            "game.id IN (:...gameIds)",
            { gameIds: [1, 2] },
        );
        // MySQL returns bigint columns as strings.
        expect(rows).toEqual([{ gameId: 1, genreId: 10, genreName: "RPG" }]);
    });
});

describe("GameRepositoryService.findGamesByCollectionType", () => {
    it("rejects malformed dates without reading the cache or the database", async () => {
        const { service, query, cache, gameRepository } = collectionFixture();

        await expect(
            service.findGamesByCollectionType(
                collectionDto({ from: "not-a-date" }),
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.findGamesByCollectionType(
                collectionDto({ to: "2025-02-30-nope" }),
            ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(cache.get).not.toHaveBeenCalled();
        expect(gameRepository.createQueryBuilder).not.toHaveBeenCalled();
        expect(query.getManyAndCount).not.toHaveBeenCalled();
    });

    it("rejects inverted bounds without querying", async () => {
        const { service, gameRepository } = collectionFixture();

        await expect(
            service.findGamesByCollectionType(
                collectionDto({ from: "2025-02-01", to: "2025-01-01" }),
            ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(gameRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it("defaults upcoming to the start of today (UTC) without an upper bound", async () => {
        const { service, query } = collectionFixture();

        await service.findGamesByCollectionType(collectionDto());

        const { from } = findBound(query, ">= :from") as { from: Date };
        const expected = new Date();
        expected.setUTCHours(0, 0, 0, 0);
        expect(from.getTime()).toBe(expected.getTime());
        expect(findBound(query, "<= :to")).toBeUndefined();
    });

    it("applies provided bounds inclusively", async () => {
        const { service, query } = collectionFixture();

        await service.findGamesByCollectionType(
            collectionDto({ from: "2025-05-01", to: "2025-05-30" }),
        );

        expect(findBound(query, ">= :from")?.from).toEqual(
            new Date("2025-05-01"),
        );
        expect(findBound(query, "<= :to")?.to).toEqual(new Date("2025-05-30"));
    });

    it("defaults recently released to the trailing 30 days through today (UTC)", async () => {
        const { service, query } = collectionFixture();
        const before = Date.now();

        await service.findGamesByCollectionType(
            collectionDto({
                collectionType: GameRepositoryCollectionType.RECENTLY_RELEASED,
            }),
        );

        const after = Date.now();
        const from = findBound(query, ">= :from")!.from as Date;
        const to = findBound(query, "<= :to")!.to as Date;
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        expect(from.getTime()).toBeGreaterThanOrEqual(before - thirtyDays);
        expect(from.getTime()).toBeLessThanOrEqual(after - thirtyDays);
        expect(to.getUTCHours()).toBe(23);
        expect(to.getUTCMinutes()).toBe(59);
        expect(to.getUTCSeconds()).toBe(59);
    });

    it("allows bounds to override both recently released defaults", async () => {
        const { service, query } = collectionFixture();

        await service.findGamesByCollectionType(
            collectionDto({
                collectionType: GameRepositoryCollectionType.RECENTLY_RELEASED,
                from: "2025-03-01",
                to: "2025-03-31",
            }),
        );

        expect(findBound(query, ">= :from")?.from).toEqual(
            new Date("2025-03-01"),
        );
        expect(findBound(query, "<= :to")?.to).toEqual(new Date("2025-03-31"));
    });

    it("excludes mature games with NOT EXISTS and keeps unthemed games eligible", async () => {
        const { service, query } = collectionFixture();

        await service.findGamesByCollectionType(collectionDto());

        expect(query.where).toHaveBeenCalledWith(
            "NOT EXISTS (SELECT 1 FROM game_themes_game_theme mature WHERE mature.gameId = game.id AND mature.gameThemeId = :matureThemeId)",
            { matureThemeId: MATURE_THEME_ID },
        );
        // A join-based theme filter would drop games without themes.
        expect(query.where.mock.calls[0][0]).not.toContain(
            "JOIN game_themes_game_theme",
        );
    });

    it("projects only the lean game fields", async () => {
        const { service, query } = collectionFixture();

        await service.findGamesByCollectionType(collectionDto());

        expect(query.select).toHaveBeenCalledWith([
            "game.id",
            "game.name",
            "game.slug",
            "game.category",
            "game.status",
            "game.firstReleaseDate",
            "game.summary",
        ]);
    });

    it("projects slim cover and platform relations when requested", async () => {
        const { service, query } = collectionFixture();

        await service.findGamesByCollectionType(
            collectionDto({ relations: { cover: true, platforms: true } }),
        );

        expect(query.leftJoin).toHaveBeenCalledWith("game.cover", "cover");
        expect(query.addSelect).toHaveBeenCalledWith([
            "cover.id",
            "cover.imageId",
            "cover.url",
            "cover.width",
            "cover.height",
            "cover.gameId",
        ]);
        expect(query.leftJoin).toHaveBeenCalledWith(
            "game.platforms",
            "platforms",
        );
        expect(query.addSelect).toHaveBeenCalledWith([
            "platforms.id",
            "platforms.name",
            "platforms.abbreviation",
        ]);
    });

    it("joins other requested relations normally", async () => {
        const { service, query } = collectionFixture();

        await service.findGamesByCollectionType(
            collectionDto({ relations: { genres: true } }),
        );

        expect(query.leftJoinAndSelect).toHaveBeenCalledWith(
            "game.genres",
            "genres",
        );
    });

    it("serves repeated identical queries from cache", async () => {
        const { service, cache, gameRepository } = collectionFixture();
        const cached: [Game[], number] = [[game(1)], 1];
        cache.get.mockResolvedValueOnce(cached);

        const result = await service.findGamesByCollectionType(
            collectionDto({ offset: 0, limit: 20 }),
        );

        expect(result).toBe(cached);
        expect(gameRepository.createQueryBuilder).not.toHaveBeenCalled();
        expect(cache.get).toHaveBeenCalledWith(
            expect.stringContaining("game-repo:collection:v1:upcoming"),
        );
    });

    it("includes the UTC day bucket when bounds are omitted", async () => {
        const { service, cache } = collectionFixture();

        await service.findGamesByCollectionType(collectionDto());

        expect(cache.get.mock.calls[0][0]).toContain(
            new Date().toISOString().slice(0, 10),
        );
    });

    it("caches the normalized query for 15 minutes", async () => {
        const { service, cache, query } = collectionFixture([[game(1)], 1]);

        await service.findGamesByCollectionType(
            collectionDto({
                collectionType: GameRepositoryCollectionType.RECENTLY_RELEASED,
                from: "2025-03-01",
                to: "2025-03-31",
                offset: 10,
                limit: 5,
            }),
        );

        expect(query.skip).toHaveBeenCalledWith(10);
        expect(query.take).toHaveBeenCalledWith(5);
        expect(cache.set).toHaveBeenCalledWith(
            expect.stringContaining(
                "game-repo:collection:v1:recently_released:2025-03-01:2025-03-31:fixed:10:5",
            ),
            [[game(1)], 1],
            minutes(15),
        );
    });

    it("falls back to the database when the cache read fails", async () => {
        const { service, cache, query } = collectionFixture([[game(1)], 1]);
        cache.get.mockRejectedValueOnce(new Error("redis down"));

        const result = await service.findGamesByCollectionType(collectionDto());

        expect(result).toEqual([[game(1)], 1]);
        expect(query.getManyAndCount).toHaveBeenCalledTimes(1);
    });

    it("ignores cache write failures", async () => {
        const { service, cache } = collectionFixture([[game(1)], 1]);
        cache.set.mockRejectedValueOnce(new Error("redis down"));

        await expect(
            service.findGamesByCollectionType(collectionDto()),
        ).resolves.toEqual([[game(1)], 1]);
    });
});

describe("GameRepositoryService.findAllByIds", () => {
    it("rejects an empty gameIds list without reading the cache", async () => {
        const cache = cacheStub();
        const service = createService({ find: jest.fn() }, cache);

        await expect(
            service.findAllByIds({ gameIds: [] }),
        ).rejects.toMatchObject({ status: 400 });
        expect(cache.mget).not.toHaveBeenCalled();
    });

    it("queries only missed ids and preserves the requested order", async () => {
        const cache = cacheStub();
        const find = jest.fn(async () => [game(3)]);
        cache.mget.mockResolvedValueOnce([game(1), null]);
        const service = createService({ find }, cache);

        const result = await service.findAllByIds({
            gameIds: [1, 2, 3],
            relations: { cover: true },
        });

        expect(cache.mget).toHaveBeenCalledWith([
            'game-repo:v1:1:{"cover":true}',
            'game-repo:v1:2:{"cover":true}',
            'game-repo:v1:3:{"cover":true}',
        ]);
        expect(find).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: expect.anything() } }),
        );
        expect(result.map((item) => item.id)).toEqual([1, 3]);
        expect(cache.mset).toHaveBeenCalledWith([
            expect.objectContaining({ key: 'game-repo:v1:3:{"cover":true}' }),
        ]);
    });

    it("throws 404 when neither cache nor database has a requested game", async () => {
        const cache = cacheStub();
        cache.mget.mockResolvedValueOnce([null]);
        const service = createService({ find: jest.fn(async () => []) }, cache);

        await expect(
            service.findAllByIds({ gameIds: [9] }),
        ).rejects.toMatchObject({ status: 404 });
    });

    it("treats cache read failures as misses", async () => {
        const cache = cacheStub();
        cache.mget.mockRejectedValueOnce(new Error("redis down"));
        const find = jest.fn(async () => [game(4)]);
        const service = createService({ find }, cache);

        const result = await service.findAllByIds({ gameIds: [4] });

        expect(result.map((item) => item.id)).toEqual([4]);
        expect(find).toHaveBeenCalledTimes(1);
    });

    it("shares cache keys for equivalent relation objects in any key order", async () => {
        const cache = cacheStub();
        cache.mget.mockResolvedValue([]);
        const service = createService(
            { find: jest.fn(async () => [game(1)]) },
            cache,
        );

        await service.findAllByIds({
            gameIds: [1],
            relations: { cover: true, platforms: true },
        });
        await service.findAllByIds({
            gameIds: [1],
            relations: { platforms: true, cover: true },
        });

        expect(cache.mget.mock.calls[0][0]).toEqual(
            cache.mget.mock.calls[1][0],
        );
    });
});

describe("GameRepositoryService per-game cache", () => {
    function memoryCache() {
        const store = new Map<string, unknown>();
        return {
            store,
            get: jest.fn(async (key: string) => store.get(key) ?? null),
            set: jest.fn(async (key: string, value: unknown) => {
                store.set(key, value);
                return value;
            }),
            mget: jest.fn(async (keys: string[]) =>
                keys.map((key) => store.get(key) ?? null),
            ),
            mset: jest.fn(
                async (entries: Array<{ key: string; value: unknown }>) => {
                    for (const entry of entries) {
                        store.set(entry.key, entry.value);
                    }
                    return entries;
                },
            ),
        };
    }

    it("warms batch reads from a single lookup with the same key", async () => {
        const cache = memoryCache();
        const repoGame = game(7, { cover: { id: 1 } as never });
        const findOneOrFail = jest.fn(async () => repoGame);
        const find = jest.fn(async () => []);
        const service = createService({ findOneOrFail, find }, cache);

        await service.findOneByIdOrFail(7, { relations: { cover: true } });
        const batch = await service.findAllByIds({
            gameIds: [7],
            relations: { cover: true },
        });

        expect(cache.mset).toHaveBeenCalledWith([
            expect.objectContaining({
                key: 'game-repo:v1:7:{"cover":true}',
                value: expect.objectContaining({ id: 7 }),
                ttl: minutes(5),
            }),
        ]);
        expect(find).not.toHaveBeenCalled();
        expect(batch.map((item) => item.id)).toEqual([7]);
    });

    it("warms single lookups from a batch read", async () => {
        const cache = memoryCache();
        const find = jest.fn(async () => [game(8)]);
        const findOneOrFail = jest.fn();
        const service = createService({ find, findOneOrFail }, cache);

        await service.findAllByIds({ gameIds: [8] });
        const single = await service.findOneByIdOrFail(8);

        expect(findOneOrFail).not.toHaveBeenCalled();
        expect(single.id).toBe(8);
    });

    it("does not let callers mutate the shared cached game", async () => {
        const cache = memoryCache();
        const repoGame = game(5, { cover: { id: 1 } as never });
        const service = createService(
            { findOneOrFail: jest.fn(async () => repoGame), find: jest.fn() },
            cache,
        );

        const first = await service.findOneByIdOrFail(5, {
            relations: { cover: true },
        });
        first.cover = { id: 2 } as never;

        const second = await service.findOneByIdOrFail(5, {
            relations: { cover: true },
        });
        expect(second.cover).toEqual({ id: 1 });
    });

    it("caches single lookups for 5 minutes", async () => {
        const cache = cacheStub();
        const service = createService(
            { findOneOrFail: jest.fn(async () => game(3)), find: jest.fn() },
            cache,
        );

        await service.findOneByIdOrFail(3);

        expect(cache.mset).toHaveBeenCalledWith([
            expect.objectContaining({
                key: "game-repo:v1:3:{}",
                value: expect.objectContaining({ id: 3 }),
                ttl: minutes(5),
            }),
        ]);
    });
});
