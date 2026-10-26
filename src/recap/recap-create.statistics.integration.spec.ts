import "reflect-metadata";
import { randomUUID } from "node:crypto";
import dayjs from "dayjs";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { RecapCreateService } from "./recap-create.service";

describe("recap likes from retained statistics facts", () => {
    let dataSource: DataSource;
    let service: RecapCreateService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new RecapCreateService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, dataSource);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it("counts retained additions after unlike with an exact end-exclusive boundary", async () => {
        const actor = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [actor, `u_${actor.slice(0, 16)}`],
        );
        const target = await dataSource.query("INSERT INTO statistics_target (sourceType, isActive) VALUES ('post', 1)");
        const targetId = Number(target.insertId);
        await dataSource.query(
            `INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, projectionState, nextAttemptAt)
             VALUES (?, 1, 'like.added', ?, ?, '2024-01-01 00:00:00.000000', 'done', CURRENT_TIMESTAMP(6)),
                    (?, 1, 'like.removed', ?, ?, '2024-01-01 12:00:00.000000', 'done', CURRENT_TIMESTAMP(6)),
                    (?, 1, 'like.added', ?, ?, '2024-01-02 00:00:00.000000', 'done', CURRENT_TIMESTAMP(6))`,
            [randomUUID(), targetId, actor, randomUUID(), targetId, actor, randomUUID(), targetId, actor],
        );

        const result = await (service as any).getLikesPerformedInPeriod(actor, {
            startDate: dayjs("2024-01-01T00:00:00.000Z"),
            endDate: dayjs("2024-01-01T23:59:59.999Z"),
        });

        expect(result).toMatchObject({ total: 1, historyComplete: true });
        expect(result.completeSince).toBeNull();
    });
});
