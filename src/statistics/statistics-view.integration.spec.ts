import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { StatisticsProjectionService } from "./statistics-projection.service";
import { StatisticsService } from "./statistics.service";
import { StatisticsSourceType } from "./statistics.constants";

describe("statistics views and temporal reads", () => {
    let dataSource: DataSource;
    let service: StatisticsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new StatisticsService(dataSource);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    async function createPost(ownerId = randomUUID()) {
        const postId = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [ownerId, `u_${ownerId.slice(0, 16)}`],
        );
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'View fixture')",
            [postId, ownerId],
        );
        return postId;
    }

    const viewDto = (sourceId: string, viewId = randomUUID()) => ({
        sourceType: StatisticsSourceType.POST,
        sourceId,
        viewId,
    });

    it("acknowledges only a committed, retry-stable view and tracks authenticated status", async () => {
        const actor = randomUUID();
        const sourceId = await createPost();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [actor, `u_${actor.slice(0, 16)}`],
        );
        const request = viewDto(sourceId);
        await expect(Promise.all([
            service.recordView(actor, request),
            service.recordView(actor, request),
        ])).resolves.toEqual([
            { accepted: true, viewId: request.viewId },
            { accepted: true, viewId: request.viewId },
        ]);
        await expect(service.recordView(actor, request)).resolves.toEqual({ accepted: true, viewId: request.viewId });
        await service.recordView(actor, { ...request, viewId: request.viewId.toUpperCase() });
        const events = await dataSource.query(
            "SELECT id FROM statistics_event WHERE eventKey = ?",
            [`view:${request.viewId}`],
        );
        expect(events).toHaveLength(1);
        expect(await service.getStatus(request, actor)).toEqual({ isLiked: false, isViewed: true });
        expect(await service.getStatus(request)).toEqual({ isLiked: false, isViewed: false });
        expect(await service.findSummary(request)).toMatchObject({ viewsCount: 0, likesCount: 0 });
    });

    it("rejects a reused view identity bound to another source or actor", async () => {
        const first = await createPost();
        const second = await createPost();
        const request = viewDto(first);
        await service.recordView(undefined, request);
        await expect(service.recordView(undefined, viewDto(second, request.viewId))).rejects.toThrow(ConflictException);
        await expect(service.recordView(randomUUID(), request)).rejects.toThrow(ConflictException);
        expect(await dataSource.query("SELECT id FROM statistics_event WHERE eventKey = ?", [`view:${request.viewId}`])).toHaveLength(1);
    });

    it("does not acknowledge or retain state when view persistence fails", async () => {
        const actor = randomUUID();
        const sourceId = await createPost();
        const request = viewDto(sourceId);
        const createRunner = dataSource.createQueryRunner.bind(dataSource);
        const factory = jest.spyOn(dataSource, "createQueryRunner").mockImplementation((mode) => {
            const runner = createRunner(mode);
            const query = runner.query.bind(runner);
            jest.spyOn(runner, "query").mockImplementation(async (...args: any[]) => {
                if (typeof args[0] === "string" && args[0].includes("INSERT IGNORE INTO statistics_event"))
                    throw new Error("view event unavailable");
                return query(args[0], args[1], args[2]);
            });
            return runner;
        });
        try {
            await expect(service.recordView(actor, request)).rejects.toThrow("view event unavailable");
        } finally {
            factory.mockRestore();
        }
        expect(await dataSource.query("SELECT statisticsTargetId FROM post WHERE id = ?", [sourceId])).toEqual([{ statisticsTargetId: null }]);
        expect(await dataSource.query("SELECT * FROM engagement_state WHERE profileUserId = ?", [actor])).toEqual([]);
        expect(await dataSource.query("SELECT id FROM statistics_event WHERE eventKey = ?", [`view:${request.viewId}`])).toEqual([]);
    });

    it("uses exact half-open edges and projected whole-hour interiors", async () => {
        const sourceId = await createPost();
        const initial = viewDto(sourceId);
        await service.recordView(undefined, initial);
        const [target] = await dataSource.query("SELECT statisticsTargetId FROM post WHERE id = ?", [sourceId]);
        const targetId = Number(target.statisticsTargetId);
        const from = new Date("2024-01-01T10:20:00.000Z");
        const to = new Date("2024-01-01T12:10:00.000Z");
        const times = [
            "2024-01-01 10:19:59.000000",
            "2024-01-01 10:20:00.000000",
            "2024-01-01 10:59:59.000000",
            "2024-01-01 11:30:00.000000",
            "2024-01-01 12:09:59.000000",
            "2024-01-01 12:10:00.000000",
        ];
        for (const [index, occurredAt] of times.entries()) {
            await dataSource.query(
                `INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, occurredAt, provenance, projectionState, nextAttemptAt)
                VALUES (?, 1, 'view.recorded', ?, ?, 'live', 'pending', CURRENT_TIMESTAMP(6))`,
                [`series-boundary:${randomUUID()}:${index}`, targetId, occurredAt],
            );
        }
        await new StatisticsProjectionService(dataSource).drain();
        const series = await service.findSeries({
            sourceType: StatisticsSourceType.POST,
            sourceId,
            metric: "views" as any,
            from: from.toISOString(),
            to: to.toISOString(),
            granularity: "hour" as any,
        });
        expect(series.buckets).toEqual([
            { start: "2024-01-01T10:00:00.000Z", value: 2 },
            { start: "2024-01-01T11:00:00.000Z", value: 1 },
            { start: "2024-01-01T12:00:00.000Z", value: 1 },
        ]);
    });

    it("keeps microseconds on both half-open boundaries", async () => {
        const sourceId = await createPost();
        await service.findSummary(viewDto(sourceId));
        const [target] = await dataSource.query("SELECT statisticsTargetId FROM post WHERE id = ?", [sourceId]);
        const targetId = Number(target.statisticsTargetId);
        const namespace = randomUUID();
        for (const [index, occurredAt] of [
            "2024-02-01 10:20:00.000122",
            "2024-02-01 10:20:00.000123",
            "2024-02-01 10:59:59.999999",
            "2024-02-01 12:10:00.000122",
            "2024-02-01 12:10:00.000123",
        ].entries()) {
            await dataSource.query(
                `INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, occurredAt, provenance, projectionState, nextAttemptAt)
                VALUES (?, 1, 'view.recorded', ?, ?, 'live', 'pending', CURRENT_TIMESTAMP(6))`,
                [`micro-boundary:${namespace}:${index}`, targetId, occurredAt],
            );
        }
        await new StatisticsProjectionService(dataSource).drain();
        const series = await service.findSeries({
            sourceType: StatisticsSourceType.POST,
            sourceId,
            metric: "views" as any,
            from: "2024-02-01T10:20:00.000123Z",
            to: "2024-02-01T12:10:00.000123Z",
            granularity: "hour" as any,
        });
        expect(series.buckets).toEqual([
            { start: "2024-02-01T10:00:00.000Z", value: 2 },
            { start: "2024-02-01T11:00:00.000Z", value: 0 },
            { start: "2024-02-01T12:00:00.000Z", value: 1 },
        ]);
        expect(series.from).toBe("2024-02-01T10:20:00.000123Z");
        expect(series.to).toBe("2024-02-01T12:10:00.000123Z");
        const sameHour = await service.findSeries({
            sourceType: StatisticsSourceType.POST,
            sourceId,
            metric: "views" as any,
            from: "2024-02-01T10:20:00.000123Z",
            to: "2024-02-01T10:20:00.000125Z",
            granularity: "hour" as any,
        });
        expect(sameHour.buckets).toEqual([{ start: "2024-02-01T10:00:00.000Z", value: 1 }]);
        const normalizedDay = await service.findSeries({
            sourceType: StatisticsSourceType.POST,
            sourceId,
            metric: "views" as any,
            from: "2024-02-01T11:20:00.000123+01:00",
            to: "2024-02-01T13:10:00.000123+01:00",
            granularity: "day" as any,
        });
        expect(normalizedDay.buckets).toEqual([{ start: "2024-02-01T00:00:00.000Z", value: 3 }]);
    });
});
