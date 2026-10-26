import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { StatisticsProjectionService } from "./statistics-projection.service";

describe("statistics event projection", () => {
    let dataSource: DataSource;
    let projector: StatisticsProjectionService;
    const targetIds: number[] = [];
    const eventKeys: string[] = [];

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        projector = new StatisticsProjectionService(dataSource);
    });

    beforeEach(async () => {
        await dataSource.query(
            "UPDATE statistics_event SET projectionState = 'done' WHERE projectionState = 'pending'",
        );
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    afterEach(async () => {
        if (eventKeys.length) {
            await dataSource.query("DELETE FROM statistics_event WHERE eventKey IN (?)", [eventKeys]);
            eventKeys.length = 0;
        }
        if (targetIds.length) {
            await dataSource.query("DELETE FROM metric_hour WHERE targetId IN (?)", [targetIds]);
            await dataSource.query("DELETE FROM metric_total WHERE targetId IN (?)", [targetIds]);
            await dataSource.query("DELETE FROM statistics_target WHERE id IN (?)", [targetIds]);
            targetIds.length = 0;
        }
    });

    async function createTarget() {
        const result = await dataSource.query(
            "INSERT INTO statistics_target (sourceType, isActive) VALUES ('post', 1)",
        );
        const targetId = Number(result.insertId);
        targetIds.push(targetId);
        return targetId;
    }

    async function createEvent(
        targetId: number,
        eventKey: string,
        eventKind: string,
        occurredAt: string,
        firstLikeCredit = false,
        eventVersion = 1,
    ) {
        await dataSource.query(
            `INSERT INTO statistics_event
             (eventKey, eventVersion, eventKind, targetId, occurredAt, firstLikeCredit, projectionState, attempts, nextAttemptAt)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP(6))`,
            [eventKey, eventVersion, eventKind, targetId, occurredAt, firstLikeCredit ? 1 : 0],
        );
        eventKeys.push(eventKey);
    }

    it("projects each accepted fact once into its total and UTC hour", async () => {
        const target = await createTarget();
        const namespace = randomUUID();
        const occurredAt = "2025-04-12 10:25:00.000000";
        await createEvent(target, `${namespace}:view`, "view.recorded", occurredAt);
        await createEvent(target, `${namespace}:like-1`, "like.added", occurredAt, true);
        await createEvent(target, `${namespace}:like-2`, "like.added", occurredAt);
        await createEvent(target, `${namespace}:unlike`, "like.removed", occurredAt);

        const batches = await Promise.all([projector.drain(2), projector.drain(2)]);
        expect(batches.every((size) => size <= 2)).toBe(true);
        for (let attempt = 0; attempt < 4; attempt++) {
            await dataSource.query(
                "UPDATE statistics_event SET nextAttemptAt = CURRENT_TIMESTAMP(6) WHERE projectionState = 'pending'",
            );
            await projector.drain(2);
        }
        expect(
            await dataSource.query(
                "SELECT COUNT(*) AS count FROM statistics_event WHERE targetId = ? AND projectionState <> 'done'",
                [target],
            ),
        ).toEqual([{ count: 0 }]);
        expect(await projector.drain(2)).toBe(0);
        const totals = await dataSource.query(
            "SELECT metricCode, metricValue FROM metric_total WHERE targetId = ? ORDER BY metricCode",
            [target],
        );
        expect(totals).toEqual([
            { metricCode: "like_credit", metricValue: 1 },
            { metricCode: "likes_added", metricValue: 2 },
            { metricCode: "likes_removed", metricValue: 1 },
            { metricCode: "views", metricValue: 1 },
        ]);
        const hour = await dataSource.query(
            "SELECT COUNT(*) AS rowCount, SUM(metricValue) AS value FROM metric_hour WHERE targetId = ? AND bucketStart = ?",
            [target, "2025-04-12 10:00:00.000000"],
        );
        expect(Number(hour[0].rowCount)).toBe(4);
        expect(Number(hour[0].value)).toBe(5);
    });

    it("backs off a poison fact without blocking later valid work and supports targeted rearm", async () => {
        const target = await createTarget();
        const namespace = randomUUID();
        const poisonKey = `${namespace}:poison`;
        const laterKey = `${namespace}:valid`;
        await createEvent(
            target,
            poisonKey,
            "unknown.kind",
            "2025-04-12 11:00:00.000000",
            false,
            99,
        );
        await createEvent(
            target,
            laterKey,
            "view.recorded",
            "2025-04-12 11:00:00.000000",
        );

        await projector.drain();
        const poison = await dataSource.query(
            "SELECT id, projectionState, attempts, lastError FROM statistics_event WHERE eventKey = ?",
            [poisonKey],
        );
        expect(poison[0].projectionState).toBe("pending");
        expect(Number(poison[0].attempts)).toBe(1);
        expect(poison[0].lastError).toContain("unsupported event version");
        await projector.drain();
        expect(
            await dataSource.query(
                "SELECT projectionState FROM statistics_event WHERE eventKey = ?",
                [laterKey],
            ),
        ).toEqual([{ projectionState: "done" }]);

        const poisonId = Number(poison[0].id);
        await dataSource.query(
            "UPDATE statistics_event SET attempts = 5, nextAttemptAt = CURRENT_TIMESTAMP(6) WHERE id = ?",
            [poisonId],
        );
        await projector.drain();
        expect(
            await dataSource.query(
                "SELECT projectionState, attempts FROM statistics_event WHERE id = ?",
                [poisonId],
            ),
        ).toEqual([{ projectionState: "failed", attempts: 6 }]);
        expect(await projector.rearm(poisonId)).toBe(true);
        expect(await projector.rearm(poisonId)).toBe(false);
    });

    it("enforces the admitted batch bound", async () => {
        await expect(projector.drain(201)).rejects.toThrow("between 1 and 200");
    });

    it("rolls back a failed fact, advances valid work, and replays without duplicate totals", async () => {
        const failedTarget = await createTarget();
        const validTarget = await createTarget();
        const key = randomUUID();
        await createEvent(failedTarget, `${key}:failed`, "view.recorded", "2025-04-12 11:00:00");
        await createEvent(validTarget, `${key}:valid`, "view.recorded", "2025-04-12 11:00:00");
        const createRunner = dataSource.createQueryRunner.bind(dataSource);
        let injected = false;
        const failure = jest.spyOn(dataSource, "createQueryRunner").mockImplementation((mode) => {
            const runner = createRunner(mode);
            const query = runner.query.bind(runner);
            jest.spyOn(runner, "query").mockImplementation(async (...args) => {
                if (!injected && args[0].startsWith("UPDATE statistics_event SET projectionState = 'done'")) {
                    injected = true;
                    throw new Error("completion write failed");
                }
                return query(...args);
            });
            return runner;
        });
        try { await projector.drain(2); }
        finally { failure.mockRestore(); }
        expect(injected).toBe(true);
        expect(await dataSource.query("SELECT metricValue FROM metric_total WHERE targetId = ?", [failedTarget])).toEqual([]);
        expect(await dataSource.query("SELECT projectionState, attempts FROM statistics_event WHERE eventKey = ?", [`${key}:failed`]))
            .toEqual([{ projectionState: "pending", attempts: 1 }]);
        expect(await dataSource.query("SELECT metricValue FROM metric_total WHERE targetId = ? AND metricCode = 'views'", [validTarget]))
            .toEqual([{ metricValue: 1 }]);
        await dataSource.query("UPDATE statistics_event SET nextAttemptAt = CURRENT_TIMESTAMP(6) WHERE eventKey = ?", [`${key}:failed`]);
        await projector.drain(2);
        await projector.drain(2);
        expect(await dataSource.query("SELECT metricValue FROM metric_total WHERE targetId IN (?) AND metricCode = 'views'", [[failedTarget, validTarget]]))
            .toEqual([{ metricValue: 1 }, { metricValue: 1 }]);
    });
});
