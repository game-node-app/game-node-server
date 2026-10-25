import { setCacheManager } from "../utils/cacheable";
import { PlaytimeHistoryService } from "./playtime-history.service";

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
    const service = new PlaytimeHistoryService(
        { createQueryBuilder: jest.fn(() => queryBuilder) } as any,
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
});
