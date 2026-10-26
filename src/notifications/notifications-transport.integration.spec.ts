import { DataSource } from "typeorm";
import { Queue, QueueEvents, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { testEnvironment } from "../../test/igdb/helpers/test-environment";
import { StatisticsService } from "../statistics/statistics.service";
import { StatisticsSourceType } from "../statistics/statistics.constants";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationsProjectorService } from "./notifications-projector.service";
import {
    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
    NOTIFICATIONS_QUEUE_NAME,
} from "./notifications.constants";

describe("durable notification transport on disposable Redis", () => {
    let source: DataSource;
    const connection = {
        ...testEnvironment(process.env).redis,
        maxRetriesPerRequest: null,
    };
    beforeAll(async () => {
        source = await createNotificationTestDataSource();
    });
    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
    });

    it.each(["disconnected", "accepted_then_lost", "redis_restart"])(
        "preserves committed reactions and projects once after %s",
        async (failure) => {
            const owner = randomUUID(),
                actor = randomUUID(),
                postId = randomUUID();
            for (const user of [owner, actor])
                await source.query(
                    "INSERT INTO profile (userId, username) VALUES (?, ?)",
                    [user, `tr_${user.slice(0, 12)}`],
                );
            await source.query(
                "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Transport fixture')",
                [postId, owner],
            );
            const prefix = `igdb-test-notifications-${randomUUID()}`;
            let queue = new Queue(NOTIFICATIONS_QUEUE_NAME, {
                connection,
                prefix,
            });
            let events: QueueEvents | undefined;
            const workers: Worker[] = [];
            const repository = source.getRepository(NotificationOutbox);
            try {
                await queue.waitUntilReady();
                const client = await queue.client;
                expect(await client.config("GET", "appendonly")).toEqual([
                    "appendonly",
                    "yes",
                ]);
                expect(await client.config("GET", "maxmemory-policy")).toEqual([
                    "maxmemory-policy",
                    "noeviction",
                ]);
                if (failure === "disconnected") await queue.disconnect();

                expect(
                    await new StatisticsService(source).applyReaction(
                        actor,
                        {
                            sourceType: StatisticsSourceType.POST,
                            sourceId: postId,
                        },
                        true,
                    ),
                ).toEqual({ isLiked: true, likesCount: 1 });
                const intent = await repository.findOneByOrFail({
                    actorUserId: actor,
                    recipientUserId: owner,
                });
                let relay = new NotificationsRelayService(
                    source,
                    repository,
                    queue,
                );
                await repository.update(intent.id, {
                    nextAttemptAt: new Date("2000-01-01"),
                });
                let claimed = (await relay.claimDueRows(1))[0];
                expect(claimed.id).toBe(intent.id);
                await relay.publishClaimedRows([claimed]);

                if (failure === "disconnected") {
                    expect(
                        await repository.findOneByOrFail({ id: intent.id }),
                    ).toMatchObject({
                        state: "pending",
                        attempts: 1,
                        lastError: "transport_unavailable",
                    });
                    await queue.close();
                    queue = new Queue(NOTIFICATIONS_QUEUE_NAME, {
                        connection,
                        prefix,
                    });
                    await queue.waitUntilReady();
                    relay = new NotificationsRelayService(
                        source,
                        repository,
                        queue,
                    );
                    await repository.update(intent.id, {
                        nextAttemptAt: new Date("2000-01-01"),
                    });
                    claimed = (await relay.claimDueRows(1))[0];
                    await relay.publishClaimedRows([claimed]);
                } else if (failure === "accepted_then_lost") {
                    const job = await queue.getJob(
                        `notification-${intent.id}-${claimed.ownerToken}`,
                    );
                    await job!.remove();
                    await repository.update(intent.id, {
                        ownerExpiresAt: new Date(Date.now() - 1000),
                    });
                    expect(
                        (await relay.claimDueRows(1)).some(
                            (row) => row.id === intent.id,
                        ),
                    ).toBe(false);
                    expect(
                        await repository.findOneByOrFail({ id: intent.id }),
                    ).toMatchObject({
                        state: "pending",
                        lastError: "owner_expired",
                    });
                    await repository.update(intent.id, {
                        nextAttemptAt: new Date("2000-01-01"),
                    });
                    claimed = (await relay.claimDueRows(1))[0];
                    await relay.publishClaimedRows([claimed]);
                } else {
                    await queue.close();
                    const compose = [
                        "compose",
                        "-p",
                        "igdb-sync-test",
                        "-f",
                        resolve(
                            __dirname,
                            "../../test/igdb/docker-compose.yml",
                        ),
                    ];
                    execFileSync("docker", [...compose, "restart", "redis"], {
                        stdio: "pipe",
                    });
                    execFileSync(
                        "docker",
                        [...compose, "up", "-d", "--wait", "redis"],
                        { stdio: "pipe" },
                    );
                    queue = new Queue(NOTIFICATIONS_QUEUE_NAME, {
                        connection,
                        prefix,
                    });
                    await queue.waitUntilReady();
                    expect(
                        await queue.getJob(
                            `notification-${intent.id}-${claimed.ownerToken}`,
                        ),
                    ).toBeDefined();
                    expect(
                        await repository.findOneByOrFail({ id: intent.id }),
                    ).toMatchObject({ state: "processing" });
                }

                events = new QueueEvents(NOTIFICATIONS_QUEUE_NAME, {
                    connection,
                    prefix,
                });
                await events.waitUntilReady();
                const projector = new NotificationsProjectorService(
                    source,
                    new NotificationsRelayService(source, repository, queue),
                );
                for (let index = 0; index < 2; index++)
                    workers.push(
                        new Worker(
                            NOTIFICATIONS_QUEUE_NAME,
                            (job) =>
                                projector.projectEvent(
                                    job.data.eventId,
                                    job.data.attemptToken,
                                ),
                            { connection, prefix },
                        ),
                    );
                const job = await queue.getJob(
                    `notification-${intent.id}-${claimed.ownerToken}`,
                );
                await job!.waitUntilFinished(events, 10000);
                const duplicate = await queue.add(
                    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
                    { eventId: intent.id, attemptToken: claimed.ownerToken },
                    { attempts: 1 },
                );
                await duplicate.waitUntilFinished(events, 10000);
                expect(
                    await source
                        .getRepository(NotificationEvent)
                        .countBy({ eventId: intent.id }),
                ).toBe(1);
                expect(
                    await source
                        .getRepository(NotificationInbox)
                        .findOneByOrFail({ recipientUserId: owner }),
                ).toMatchObject({
                    eventCount: 1,
                    actorCount: 1,
                    version: 1,
                    readVersion: 0,
                });
                expect(
                    await repository.findOneByOrFail({ id: intent.id }),
                ).toMatchObject({ state: "completed" });
                expect(
                    (
                        await source.query(
                            `SELECT metricValue AS likesCount FROM metric_total
                             WHERE targetId = (SELECT statisticsTargetId FROM post WHERE id = ?)
                               AND metricCode = 'likes_current'`,
                            [postId],
                        )
                    )[0].likesCount,
                ).toBe(1);
            } finally {
                await Promise.allSettled(
                    workers.map((worker) => worker.close()),
                );
                await events?.close();
                if ((await queue.client).status === "ready")
                    await queue.obliterate({ force: true });
                await queue.close();
            }
        },
    );
});
