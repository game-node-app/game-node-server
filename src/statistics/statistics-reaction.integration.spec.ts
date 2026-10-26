import "reflect-metadata";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import * as outboxModule from "../notifications/notifications-outbox.service";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { StatisticsEvent } from "./entity/statistics-event.entity";
import { StatisticsSourceType } from "./statistics.constants";
import { StatisticsService } from "./statistics.service";
import { cleanupStatisticsProfile } from "./statistics-target.repository";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";

describe("StatisticsService reaction commands (PUT/DELETE like)", () => {
    let dataSource: DataSource;
    let service: StatisticsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new StatisticsService(dataSource);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    async function createProfile(userId: string) {
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [userId, `u_${userId.slice(0, 16)}`],
        );
    }

    async function createPost(owner: string, content = "Reaction fixture") {
        const id = randomUUID();
        await createProfile(owner);
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, ?)",
            [id, owner, content],
        );
        return id;
    }

    async function targetId(sourceType: StatisticsSourceType, sourceId: string | number) {
        const table = {
            [StatisticsSourceType.GAME]: "game",
            [StatisticsSourceType.REVIEW]: "review",
            [StatisticsSourceType.ACTIVITY]: "activity",
            [StatisticsSourceType.POST]: "post",
            [StatisticsSourceType.REVIEW_COMMENT]: "review_comment",
            [StatisticsSourceType.ACTIVITY_COMMENT]: "activity_comment",
            [StatisticsSourceType.POST_COMMENT]: "post_comment",
        }[sourceType];
        const rows = await dataSource.query(
            `SELECT statisticsTargetId FROM ${table} WHERE id = ?`,
            [sourceId],
        );
        return rows[0]?.statisticsTargetId
            ? Number(rows[0].statisticsTargetId)
            : null;
    }

    async function metric(target: number, code: string) {
        const rows = await dataSource.query(
            "SELECT metricValue FROM metric_total WHERE targetId = ? AND metricCode = ?",
            [target, code],
        );
        return Number(rows[0]?.metricValue ?? 0);
    }

    it("rejects malformed, deleted, and inaccessible source identities before writes", async () => {
        const actor = randomUUID();
        await createProfile(actor);
        const deletedPost = await createPost(randomUUID(), "Deleted fixture");
        await dataSource.query("UPDATE post SET deletedAt = NOW() WHERE id = ?", [
            deletedPost,
        ]);

        await expect(
            service.applyReaction(
                actor,
                { sourceType: StatisticsSourceType.POST, sourceId: "bad-id" } as any,
                true,
            ),
        ).rejects.toThrow(BadRequestException);
        await expect(
            service.applyReaction(
                actor,
                { sourceType: StatisticsSourceType.POST, sourceId: deletedPost },
                true,
            ),
        ).rejects.toThrow(NotFoundException);
        expect(await targetId(StatisticsSourceType.POST, deletedPost)).toBeNull();
        expect(
            await dataSource.getRepository(StatisticsEvent).countBy({
                actorUserId: actor,
            }),
        ).toBe(0);
    });

    it.each(["gauge", "analytics"])("rolls back target, state, gauge, event, and intent when the %s write fails", async (store) => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = await createPost(owner, "Gauge rollback");
        await createProfile(actor);
        const createRunner = dataSource.createQueryRunner.bind(dataSource);
        const factory = jest
            .spyOn(dataSource, "createQueryRunner")
            .mockImplementation((mode) => {
                const runner = createRunner(mode);
                const query = runner.query.bind(runner);
                jest.spyOn(runner, "query").mockImplementation(async (...args) => {
                    if (
                        typeof args[0] === "string" &&
                        args[0].startsWith(store === "gauge" ? "UPDATE metric_total" : "INSERT INTO statistics_event")
                    )
                        throw new Error(`${store} unavailable`);
                    return query(...args);
                });
                return runner;
            });
        try {
            await expect(
                service.applyReaction(
                    actor,
                    { sourceType: StatisticsSourceType.POST, sourceId: postId },
                    true,
                ),
            ).rejects.toThrow(`${store} unavailable`);
        } finally {
            factory.mockRestore();
        }

        expect(await targetId(StatisticsSourceType.POST, postId)).toBeNull();
        expect(
            await dataSource.getRepository(StatisticsEvent).countBy({ actorUserId: actor }),
        ).toBe(0);
        expect(
            await dataSource.getRepository(NotificationOutbox).countBy({ actorUserId: actor }),
        ).toBe(0);
        await expect(
            service.applyReaction(
                actor,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                true,
            ),
        ).resolves.toEqual({ isLiked: true, likesCount: 1 });
    });

    it("correlates the immutable like fact and version-1 notification intent", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = await createPost(owner);
        await createProfile(actor);

        const [first, duplicate] = await Promise.all([true, true].map(() => service.applyReaction(
            actor,
            { sourceType: StatisticsSourceType.POST, sourceId: postId },
            true,
        )));
        const target = await targetId(StatisticsSourceType.POST, postId);
        const facts = await dataSource.getRepository(StatisticsEvent).findBy({
            targetId: target!,
            eventKind: "like.added",
        });
        const intents = await dataSource.getRepository(NotificationOutbox).findBy({
            recipientUserId: owner,
            actorUserId: actor,
        });

        expect(first).toEqual({ isLiked: true, likesCount: 1 });
        expect(duplicate).toEqual(first);
        expect(facts).toHaveLength(1);
        expect(intents).toHaveLength(1);
        const fact = facts[0];
        const intent = intents[0];
        const transitionId = fact.eventKey.slice("like:".length);
        expect(fact.eventKey).toBe(`like:${transitionId}`);
        expect(intent.id).toBe(transitionId);
        expect(Number.isSafeInteger(intent.payload?.likeId)).toBe(true);
        expect(intent.payload?.likeId).toBe(fact.id);
        expect(intent.payload).toEqual({
            likeId: fact.id,
            subjectType: "post",
            subjectId: postId,
            rootType: "post",
            rootId: postId,
        });
        expect(intent.occurredAt.getTime()).toBe(fact.occurredAt.getTime());
    });

    it("preserves first-like credit and distinct transition identities across like, unlike, and relike", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = await createPost(owner, "Credit fixture");
        await createProfile(actor);
        const source = { sourceType: StatisticsSourceType.POST, sourceId: postId };

        await service.applyReaction(actor, source, true);
        await service.applyReaction(actor, source, false);
        await service.applyReaction(actor, source, true);
        const target = await targetId(StatisticsSourceType.POST, postId);
        const facts = await dataSource.getRepository(StatisticsEvent).findBy({
            targetId: target!,
        });
        const state = await dataSource.query(
            "SELECT likedAt, firstLikedAt FROM engagement_state WHERE targetId = ? AND profileUserId = ?",
            [target, actor],
        );

        expect(facts.map((fact) => fact.eventKind).sort()).toEqual([
            "like.added",
            "like.added",
            "like.removed",
        ]);
        expect(facts.filter((fact) => fact.firstLikeCredit)).toHaveLength(1);
        expect(new Set(facts.map((fact) => fact.eventKey)).size).toBe(3);
        expect(state[0].likedAt).not.toBeNull();
        expect(state[0].firstLikedAt).not.toBeNull();
        expect(await metric(target!, "likes_current")).toBe(1);
        expect(
            await dataSource.getRepository(NotificationOutbox).countBy({
                recipientUserId: owner,
                actorUserId: actor,
            }),
        ).toBe(2);
    });

    it("keeps comment subject and native root identities in the existing notification payload", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = await createPost(owner, "Comment root");
        const commentId = randomUUID();
        await createProfile(actor);
        await dataSource.query(
            "INSERT INTO post_comment (id, profileUserId, postId, content) VALUES (?, ?, ?, 'Comment fixture')",
            [commentId, owner, postId],
        );

        await service.applyReaction(
            actor,
            { sourceType: StatisticsSourceType.POST_COMMENT, sourceId: commentId },
            true,
        );
        const intent = await dataSource.getRepository(NotificationOutbox).findOneByOrFail({
            recipientUserId: owner,
            actorUserId: actor,
        });
        expect(intent.payload).toEqual({
            likeId: expect.any(Number),
            subjectType: "comment",
            subjectId: commentId,
            rootType: "post",
            rootId: postId,
        });
    });

    it("retries the full transaction after a deadlock and leaves self/game likes notification-free", async () => {
        const owner = randomUUID();
        const actorA = randomUUID();
        const actorB = randomUUID();
        const postId = await createPost(owner, "Deadlock fixture");
        for (const actor of [actorA, actorB]) await createProfile(actor);
        const actors = new AsyncLocalStorage<string>();
        const createRunner = dataSource.createQueryRunner.bind(dataSource);
        let injected = false;
        const runnerFactory = jest
            .spyOn(dataSource, "createQueryRunner")
            .mockImplementation((mode) => {
                const runner = createRunner(mode);
                const query = runner.query.bind(runner);
                jest.spyOn(runner, "query").mockImplementation(async (...args) => {
                    if (
                        !injected &&
                        typeof args[0] === "string" &&
                        args[0].includes("FROM engagement_state")
                    ) {
                        injected = true;
                        throw Object.assign(new Error("injected deadlock"), {
                            code: "ER_LOCK_DEADLOCK",
                        });
                    }
                    return query(...args);
                });
                return runner;
            });
        try {
            await Promise.all(
                [actorA, actorB].map((actor) =>
                    actors.run(actor, () =>
                        service.applyReaction(
                            actor,
                            { sourceType: StatisticsSourceType.POST, sourceId: postId },
                            true,
                        ),
                    ),
                ),
            );
        } finally {
            runnerFactory.mockRestore();
        }
        expect(injected).toBe(true);
        const target = await targetId(StatisticsSourceType.POST, postId);
        expect(await metric(target!, "likes_current")).toBe(2);
        expect(
            await dataSource.getRepository(StatisticsEvent).countBy({
                targetId: target!,
                eventKind: "like.added",
            }),
        ).toBe(2);

        await service.applyReaction(
            owner,
            { sourceType: StatisticsSourceType.POST, sourceId: postId },
            true,
        );
        await service.applyReaction(
            actorA,
            { sourceType: StatisticsSourceType.GAME, sourceId: 1 },
            true,
        );
        expect(
            await dataSource.getRepository(NotificationOutbox).countBy({
                recipientUserId: owner,
                eventType: "content.liked",
            }),
        ).toBe(2);
    });

    it("removes account state, reconciles active likes, and anonymizes retained facts without an unlike", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = await createPost(owner, "Account cleanup");
        await createProfile(actor);
        const source = { sourceType: StatisticsSourceType.POST, sourceId: postId };
        await service.recordView(actor, { ...source, viewId: randomUUID() });
        await service.applyReaction(actor, source, true);
        const target = await targetId(StatisticsSourceType.POST, postId);

        await dataSource.transaction((manager) => cleanupStatisticsProfile(manager, actor));

        expect(await metric(target!, "likes_current")).toBe(0);
        expect(await dataSource.query("SELECT * FROM engagement_state WHERE targetId = ? AND profileUserId = ?", [target, actor])).toEqual([]);
        expect(await dataSource.query("SELECT eventKind, actorUserId FROM statistics_event WHERE targetId = ? ORDER BY eventKind", [target])).toEqual([
            { eventKind: "like.added", actorUserId: null },
            { eventKind: "view.recorded", actorUserId: null },
        ]);
    });

    it("rolls back a reaction when the existing notification intent is rejected", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = await createPost(owner, "Outbox rollback");
        await createProfile(actor);
        const append = outboxModule.appendNotificationIntent;
        const appendSpy = jest
            .spyOn(outboxModule, "appendNotificationIntent")
            .mockRejectedValue(new Error("outbox unavailable"));
        try {
            await expect(
                service.applyReaction(
                    actor,
                    { sourceType: StatisticsSourceType.POST, sourceId: postId },
                    true,
                ),
            ).rejects.toThrow("outbox unavailable");
        } finally {
            appendSpy.mockRestore();
        }
        expect(await targetId(StatisticsSourceType.POST, postId)).toBeNull();
        expect(
            await dataSource.getRepository(StatisticsEvent).countBy({ actorUserId: actor }),
        ).toBe(0);
        expect(
            await dataSource.getRepository(NotificationOutbox).countBy({ actorUserId: actor }),
        ).toBe(0);
        expect(append).toBeDefined();
    });
});
