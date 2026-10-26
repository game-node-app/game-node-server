import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { StatisticsSourceType } from "./statistics.constants";
import { ensureStatisticsTarget } from "./statistics-target.repository";

describe("statistics target initialization", () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it("initializes once for a source and preserves it on replay", async () => {
        const owner = randomUUID();
        const postId = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username) VALUES (?, ?)",
            [owner, `u_${owner.slice(0, 12)}`],
        );
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Target fixture')",
            [postId, owner],
        );

        const first = await dataSource.transaction((manager) =>
            ensureStatisticsTarget(manager, StatisticsSourceType.POST, postId),
        );
        const second = await dataSource.transaction((manager) =>
            ensureStatisticsTarget(manager, StatisticsSourceType.POST, postId),
        );

        expect(first).toBeGreaterThan(0);
        expect(second).toBe(first);
        expect(
            await dataSource.query(
                "SELECT COUNT(*) AS count FROM statistics_target WHERE id = ? AND sourceType = 'post'",
                [first],
            ),
        ).toEqual([{ count: 1 }]);
        expect(
            await dataSource.query(
                "SELECT COUNT(*) AS count FROM metric_total WHERE targetId = ? AND metricCode = 'likes_current' AND metricValue = 0",
                [first],
            ),
        ).toEqual([{ count: 1 }]);
    });

    it("rolls back the source, target, and gauge together", async () => {
        const owner = randomUUID();
        const postId = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username) VALUES (?, ?)",
            [owner, `u_${owner.slice(0, 12)}`],
        );
        const before = await dataSource.query(
            "SELECT COUNT(*) AS count FROM statistics_target",
        );

        await expect(
            dataSource.transaction(async (manager) => {
                await manager.query(
                    "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Rollback fixture')",
                    [postId, owner],
                );
                await ensureStatisticsTarget(
                    manager,
                    StatisticsSourceType.POST,
                    postId,
                );
                throw new Error("abort source creation");
            }),
        ).rejects.toThrow("abort source creation");

        expect(
            await dataSource.query("SELECT id FROM post WHERE id = ?", [postId]),
        ).toEqual([]);
        expect(
            await dataSource.query("SELECT COUNT(*) AS count FROM statistics_target"),
        ).toEqual(before);
    });

    it("rejects a target linked to a different source kind", async () => {
        const owner = randomUUID();
        const postId = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username) VALUES (?, ?)",
            [owner, `u_${owner.slice(0, 12)}`],
        );
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Kind fixture')",
            [postId, owner],
        );
        const targetId = await dataSource.transaction(async (manager) => {
            const id = await ensureStatisticsTarget(
                manager,
                StatisticsSourceType.POST,
                postId,
            );
            await manager.query(
                "UPDATE statistics_target SET sourceType = 'review' WHERE id = ?",
                [id],
            );
            return id;
        });

        try {
            await expect(
                dataSource.transaction((manager) =>
                    ensureStatisticsTarget(
                        manager,
                        StatisticsSourceType.POST,
                        postId,
                    ),
                ),
            ).rejects.toThrow("source kind");
            expect(targetId).toBeGreaterThan(0);
        } finally {
            await dataSource.query("UPDATE statistics_target SET sourceType = 'post' WHERE id = ?", [targetId]);
        }
    });
});
