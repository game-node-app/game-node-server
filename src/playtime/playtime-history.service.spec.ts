import { setCacheManager } from "../utils/cacheable";
import {
    PlaytimeHistoryService,
    estimateSteamRecentPlaytimeSeconds,
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
    expect(createQueryBuilder).toHaveBeenCalledTimes(1);
});

const day = 24 * 60 * 60 * 1000;

describe("first Steam observation estimate", () => {
    it("spreads the provider recent total over the 14 days before observation", () => {
        const endDate = new Date("2026-10-25T12:00:00Z");
        const startDate = new Date(endDate.getTime() - 7 * day);
        const observedAt = new Date(endDate.getTime() - 2 * day);

        expect(
            estimateSteamRecentPlaytimeSeconds(
                50_400,
                1_000_000,
                observedAt,
                startDate,
                endDate,
            ),
        ).toBe(18_000);
    });

    it("keeps the previous window's overlap when the observation is after it", () => {
        const currentStart = new Date("2026-10-25T12:00:00Z");
        const previousStart = new Date(currentStart.getTime() - 7 * day);
        const observedAt = new Date(currentStart.getTime() + 10 * day);

        expect(
            estimateSteamRecentPlaytimeSeconds(
                50_400,
                1_000_000,
                observedAt,
                previousStart,
                currentStart,
            ),
        ).toBe(14_400);
    });

    it("conserves rounding between adjacent windows", () => {
        const endDate = new Date("2026-10-25T12:00:00Z");
        const middle = new Date(endDate.getTime() - 7 * day);
        const startDate = new Date(endDate.getTime() - 14 * day);
        const estimate = (from: Date, to: Date) =>
            estimateSteamRecentPlaytimeSeconds(101, 1_000, endDate, from, to);

        expect(estimate(startDate, middle) + estimate(middle, endDate)).toBe(
            101,
        );
    });

    it("clamps negative recent time and caps it to the lifetime total", () => {
        const endDate = new Date("2026-10-25T12:00:00Z");
        const startDate = new Date(endDate.getTime() - 14 * day);
        const observedAt = endDate;

        expect(
            estimateSteamRecentPlaytimeSeconds(
                -50,
                1_000,
                observedAt,
                startDate,
                endDate,
            ),
        ).toBe(0);
        expect(
            estimateSteamRecentPlaytimeSeconds(
                500,
                40,
                observedAt,
                startDate,
                endDate,
            ),
        ).toBe(40);
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
        "ph.createdAt < :bootstrapEndDate",
        { bootstrapEndDate: new Date(endDate.getTime() + 14 * day) },
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
