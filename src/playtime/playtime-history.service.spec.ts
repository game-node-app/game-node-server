import { setCacheManager } from "../utils/cacheable";
import { UserPlaytimeSource } from "./playtime.constants";
import {
    PlaytimeHistoryService,
    firstObservationSpread,
    spreadPlaytimeSeconds,
} from "./playtime-history.service";

beforeEach(() =>
    setCacheManager({
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
    } as any),
);

test("stores the attempt observation time in the existing history timestamp", async () => {
    const insert = jest.fn();
    const service = new PlaytimeHistoryService({ insert } as any, {} as any);
    const observationAt = new Date("2026-10-25T12:00:00.000Z");
    const playtime = {
        profileUserId: "user",
        gameId: 1,
        source: "psn",
        platformId: 7,
        totalPlaytimeSeconds: 3600,
        lastPlayedDate: new Date("2026-10-01T10:20:30.000Z"),
    } as any;

    await service.save(playtime, observationAt);

    expect(insert).toHaveBeenCalledWith({
        ...playtime,
        id: undefined,
        createdAt: observationAt,
    });
});

test("period filtering uses observation time instead of provider played dates", async () => {
    const queryBuilder: any = {};
    const chain = jest.fn(() => queryBuilder);
    Object.assign(queryBuilder, {
        select: chain,
        addSelect: chain,
        groupBy: chain,
        addGroupBy: chain,
        where: chain,
        andWhere: chain,
        subQuery: chain,
        from: chain,
        useIndex: chain,
        orderBy: chain,
        addOrderBy: chain,
        limit: chain,
        getQuery: jest.fn(() => "(SELECT previous.totalPlaytimeSeconds)"),
        getRawMany: jest.fn().mockResolvedValue([]),
    });
    const createQueryBuilder = jest.fn(() => queryBuilder);
    const service = new PlaytimeHistoryService(
        { createQueryBuilder } as any,
        {} as any,
    );
    const startDate = new Date("2026-10-11T12:00:00.000Z");
    const endDate = new Date("2026-10-25T12:00:00.000Z");

    await service.getTotalPlaytimeForPeriod({
        userId: "user",
        source: "psn" as any,
        platformId: 7,
        startDate,
        endDate,
    });

    expect(queryBuilder.where).toHaveBeenCalledWith(
        "ph.createdAt > :startDate AND ph.createdAt <= :endDate",
        { startDate, endDate },
    );
    // The second query fetches first observations for the estimate.
    expect(createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith("ph.source = :source", {
        source: "psn",
    });
});

const day = 24 * 60 * 60 * 1000;

const steamSpread = (
    recentPlaytimeSeconds: number,
    totalPlaytimeSeconds: number,
    observedAt: Date,
    startDate: Date,
    endDate: Date,
) => {
    const spread = firstObservationSpread({
        gameId: 1,
        source: UserPlaytimeSource.STEAM,
        platformId: 6,
        observedAt,
        recentPlaytimeSeconds,
        totalPlaytimeSeconds,
        firstPlayedDate: null,
        lastPlayedDate: null,
        previousSyncAt: null,
    })!;
    return spreadPlaytimeSeconds(
        spread.amount,
        spread.from,
        spread.to,
        startDate,
        endDate,
    );
};

describe("first Steam observation estimate", () => {
    it("spreads the provider recent total over the 14 days before observation", () => {
        const endDate = new Date("2026-10-25T12:00:00Z");
        const startDate = new Date(endDate.getTime() - 7 * day);
        const observedAt = new Date(endDate.getTime() - 2 * day);

        expect(
            steamSpread(50_400, 1_000_000, observedAt, startDate, endDate),
        ).toBe(18_000);
    });

    it("keeps the previous window's overlap when the observation is after it", () => {
        const currentStart = new Date("2026-10-25T12:00:00Z");
        const previousStart = new Date(currentStart.getTime() - 7 * day);
        const observedAt = new Date(currentStart.getTime() + 10 * day);

        expect(
            steamSpread(
                50_400,
                1_000_000,
                observedAt,
                previousStart,
                currentStart,
            ),
        ).toBe(14_400);
    });

    it("clamps negative recent time and caps it to the lifetime total", () => {
        const endDate = new Date("2026-10-25T12:00:00Z");
        const startDate = new Date(endDate.getTime() - 14 * day);

        expect(steamSpread(-50, 1_000, endDate, startDate, endDate)).toBe(0);
        expect(steamSpread(500, 40, endDate, startDate, endDate)).toBe(40);
    });
});

describe("spreadPlaytimeSeconds", () => {
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-11T00:00:00Z");

    it("keeps the part of a positive interval overlapping the window", () => {
        expect(
            spreadPlaytimeSeconds(
                1_000,
                from,
                to,
                new Date("2026-11-09T00:00:00Z"),
                new Date("2026-11-20T00:00:00Z"),
            ),
        ).toBe(200);
        expect(
            spreadPlaytimeSeconds(
                1_000,
                from,
                to,
                new Date("2026-11-11T00:00:00Z"),
                new Date("2026-11-20T00:00:00Z"),
            ),
        ).toBe(0);
    });

    it("conserves rounding between adjacent windows", () => {
        const middle = new Date(to.getTime() - 3 * day);
        const window = (start: Date, end: Date) =>
            spreadPlaytimeSeconds(101, from, to, start, end);

        expect(window(from, middle) + window(middle, to)).toBe(101);
        expect(
            window(new Date(from.getTime() - day), middle) +
                window(middle, new Date(to.getTime() + day)),
        ).toBe(101);
    });

    it("puts an empty or inverted interval at its end, excluding the window start", () => {
        const at = (start: Date, end: Date, start2 = to) =>
            spreadPlaytimeSeconds(500, start2, to, start, end);
        const before = new Date(to.getTime() - day);
        const after = new Date(to.getTime() + day);

        expect(at(before, to)).toBe(500);
        expect(at(to, after)).toBe(0);
        expect(at(before, to, after)).toBe(500);
        expect(at(to, after, after)).toBe(0);
    });
});

describe("first observation rules", () => {
    const observedAt = new Date("2026-11-16T15:10:00Z");
    const observation = {
        gameId: 1,
        source: UserPlaytimeSource.NSWITCH,
        platformId: 130,
        observedAt,
        recentPlaytimeSeconds: 0,
        totalPlaytimeSeconds: 7_200,
        firstPlayedDate: null,
        lastPlayedDate: null,
        previousSyncAt: null,
    };

    it("spreads from the first played date to the last played date", () => {
        const firstPlayedDate = new Date("2026-11-16T01:49:00Z");
        const lastPlayedDate = new Date("2026-11-16T11:38:00Z");

        expect(
            firstObservationSpread({
                ...observation,
                firstPlayedDate,
                lastPlayedDate,
            }),
        ).toEqual({ amount: 7_200, from: firstPlayedDate, to: lastPlayedDate });
        expect(
            firstObservationSpread({
                ...observation,
                firstPlayedDate,
                lastPlayedDate: new Date("2026-11-17T00:00:00Z"),
            }),
        ).toEqual({ amount: 7_200, from: firstPlayedDate, to: observedAt });
    });

    it("spreads Xbox games new to a syncing connection since the previous sync", () => {
        const previousSyncAt = new Date("2026-11-15T15:10:00Z");
        const xbox = {
            ...observation,
            source: UserPlaytimeSource.XBOX,
            previousSyncAt,
        };

        expect(firstObservationSpread(xbox)).toEqual({
            amount: 7_200,
            from: previousSyncAt,
            to: observedAt,
        });
        expect(
            firstObservationSpread({
                ...xbox,
                lastPlayedDate: new Date("2026-11-15T15:09:59Z"),
            }),
        ).toBeNull();
        expect(
            firstObservationSpread({ ...xbox, previousSyncAt: null }),
        ).toBeNull();
    });

    it("leaves sources without played dates at zero", () => {
        for (const source of [
            UserPlaytimeSource.EPICGAMES,
            UserPlaytimeSource.GOG,
            UserPlaytimeSource.EMULATOR,
        ]) {
            expect(
                firstObservationSpread({
                    ...observation,
                    source,
                    lastPlayedDate: observedAt,
                    previousSyncAt: new Date("2026-11-15T15:10:00Z"),
                }),
            ).toBeNull();
        }
    });
});

test("the Steam estimate query includes first observations after the window end", async () => {
    const endDate = new Date("2026-10-25T12:00:00Z");
    const startDate = new Date("2026-10-18T12:00:00Z");
    const observedAt = new Date("2026-11-04T12:00:00Z");
    const builder = () => {
        const queryBuilder: any = {};
        const chain = jest.fn(() => queryBuilder);
        Object.assign(queryBuilder, {
            select: chain,
            addSelect: chain,
            groupBy: chain,
            where: chain,
            andWhere: chain,
            subQuery: chain,
            from: chain,
            useIndex: chain,
            orderBy: chain,
            addOrderBy: chain,
            limit: chain,
            getQuery: jest.fn(() => "(SELECT previous.id)"),
        });
        return queryBuilder;
    };
    const totalsQuery = builder();
    totalsQuery.getRawMany = jest.fn().mockResolvedValue([]);
    const estimateQuery = builder();
    estimateQuery.getRawMany = jest.fn().mockResolvedValue([
        {
            gameId: "1",
            source: "steam",
            platformId: "7",
            observedAt,
            recentPlaytimeSeconds: 50_400,
            totalPlaytimeSeconds: 1_000_000,
            firstPlayedDate: null,
            lastPlayedDate: null,
            previousSyncAt: null,
        },
    ]);
    const createQueryBuilder = jest
        .fn()
        .mockReturnValueOnce(totalsQuery)
        .mockReturnValueOnce(estimateQuery);
    const service = new PlaytimeHistoryService(
        { createQueryBuilder } as any,
        {} as any,
    );

    const totals = await service.getTotalPlaytimeForPeriod({
        userId: "user",
        startDate,
        endDate,
    });

    expect(
        estimateQuery.where.mock.calls.map(([sql]: [string]) => sql),
    ).toContainEqual(expect.stringContaining("NOT EXISTS"));
    expect(estimateQuery.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("ph.createdAt < :steamEndDate"),
        expect.objectContaining({
            steamEndDate: new Date(endDate.getTime() + 14 * day),
        }),
    );
    expect(totals).toEqual([
        {
            gameId: 1,
            source: "steam",
            platformId: 7,
            totalPlaytimeInPeriodSeconds: 14_400,
            estimatedPlaytimeSeconds: 14_400,
        },
    ]);
});

test("daily period grouping attributes increments to the observed UTC day", async () => {
    const queryBuilder: any = {};
    const chain = jest.fn(() => queryBuilder);
    Object.assign(queryBuilder, {
        select: chain,
        addSelect: chain,
        groupBy: chain,
        addGroupBy: chain,
        where: chain,
        andWhere: chain,
        subQuery: chain,
        from: chain,
        useIndex: chain,
        orderBy: chain,
        addOrderBy: chain,
        limit: chain,
        getQuery: jest.fn(() => "(SELECT previous.totalPlaytimeSeconds)"),
        getRawMany: jest.fn().mockResolvedValue([
            {
                day: "2026-11-15",
                gameId: "3",
                platformId: "7",
                seconds: "120",
            },
        ]),
    });
    const service = new PlaytimeHistoryService(
        { createQueryBuilder: jest.fn(() => queryBuilder) } as any,
        {} as any,
    );
    const start = new Date("2026-11-01T00:00:00.000Z");
    const end = new Date("2026-12-01T00:00:00.000Z");

    await expect(
        service.getDailyPlaytimeForPeriod("user", start, end),
    ).resolves.toEqual([
        { day: "2026-11-15", gameId: 3, platformId: 7, seconds: 120 },
    ]);
    expect(queryBuilder.groupBy).toHaveBeenCalledWith(
        "DATE_FORMAT(ph.createdAt, '%Y-%m-%d'), ph.gameId, ph.platformId",
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
        "ph.createdAt > :start AND ph.createdAt <= :end",
        { start, end },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        "ph.profileUserId = :userId",
        { userId: "user" },
    );
});

const playtimeQueryBuilder = (rows: unknown[] = []) => {
    const queryBuilder: any = {};
    const chain = jest.fn(() => queryBuilder);
    Object.assign(queryBuilder, {
        select: chain,
        addSelect: chain,
        groupBy: chain,
        addGroupBy: chain,
        where: chain,
        andWhere: chain,
        subQuery: chain,
        from: chain,
        useIndex: chain,
        orderBy: chain,
        addOrderBy: chain,
        limit: chain,
        getQuery: jest.fn(() => "(SELECT previous.totalPlaytimeSeconds)"),
        getRawMany: jest.fn().mockResolvedValue(rows),
    });
    return queryBuilder;
};

test("guild mode sums only observations with a prior baseline", async () => {
    const queryBuilder = playtimeQueryBuilder();
    const createQueryBuilder = jest.fn(() => queryBuilder);
    const service = new PlaytimeHistoryService(
        { createQueryBuilder } as any,
        {} as any,
    );

    await service.getTotalPlaytimeForPeriod(
        {
            userId: "user",
            startDate: new Date("2026-11-01T00:00:00Z"),
            endDate: new Date("2026-12-01T00:00:00Z"),
        },
        { excludeInitialObservations: true },
    );

    // No first-observation estimate query: an initial lifetime import contributes zero.
    expect(createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("IS NOT NULL"),
    );
});

test("São Paulo day mode groups deltas by the fixed UTC-3 date", async () => {
    const queryBuilder = playtimeQueryBuilder();
    const service = new PlaytimeHistoryService(
        { createQueryBuilder: jest.fn(() => queryBuilder) } as any,
        {} as any,
    );

    await service.getDailyPlaytimeForPeriod(
        "user",
        new Date("2026-11-01T00:00:00Z"),
        new Date("2026-12-01T00:00:00Z"),
        { excludeInitialObservations: true, saoPauloDays: true },
    );

    expect(queryBuilder.select).toHaveBeenCalledWith(
        "DATE_FORMAT(CONVERT_TZ(ph.createdAt, '+00:00', '-03:00'), '%Y-%m-%d')",
        "day",
    );
    expect(queryBuilder.groupBy).toHaveBeenCalledWith(
        expect.stringContaining("CONVERT_TZ(ph.createdAt, '+00:00', '-03:00')"),
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("IS NOT NULL"),
    );
});
