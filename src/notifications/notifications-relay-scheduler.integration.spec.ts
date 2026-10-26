import "reflect-metadata";
import { Queue, QueueEvents, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { testEnvironment } from "../../test/igdb/helpers/test-environment";
import { NotificationsQueueProcessor } from "./notifications-queue.processor";
import { NotificationsRelayService } from "./notifications-relay.service";
import {
    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
    NOTIFICATIONS_QUEUE_NAME,
    NOTIFICATIONS_RELAY_SCHEDULER_ID,
    NOTIFICATIONS_RELAY_TICK_JOB_NAME,
} from "./notifications.constants";

describe("notification relay scheduler on disposable Redis", () => {
    const connection = {
        ...testEnvironment(process.env).redis,
        maxRetriesPerRequest: null,
    };

    it("shares one agenda across instances and routes tick and outbox jobs", async () => {
        const prefix = `igdb-test-notifications-scheduler-${randomUUID()}`;
        const queueA = new Queue(NOTIFICATIONS_QUEUE_NAME, {
            connection,
            prefix,
        });
        const queueB = new Queue(NOTIFICATIONS_QUEUE_NAME, {
            connection,
            prefix,
        });
        const events = new QueueEvents(NOTIFICATIONS_QUEUE_NAME, {
            connection,
            prefix,
        });
        const relayA = new NotificationsRelayService(
            {} as any,
            {} as any,
            queueA,
        );
        const relayB = new NotificationsRelayService(
            {} as any,
            {} as any,
            queueB,
        );
        const relayTick = jest.fn().mockResolvedValue(0);
        const projectEvent = jest.fn().mockResolvedValue(undefined);
        let worker: Worker | undefined;
        try {
            await Promise.all([
                queueA.waitUntilReady(),
                queueB.waitUntilReady(),
                events.waitUntilReady(),
            ]);
            await Promise.all([relayA.onModuleInit(), relayB.onModuleInit()]);

            const schedules = (
                await queueA.getJobSchedulers()
            ).filter(({ key }) => key === NOTIFICATIONS_RELAY_SCHEDULER_ID);
            expect(schedules).toHaveLength(1);
            expect(schedules[0]).toMatchObject({
                key: NOTIFICATIONS_RELAY_SCHEDULER_ID,
                name: NOTIFICATIONS_RELAY_TICK_JOB_NAME,
            });
            expect(Number(schedules[0].every)).toBe(1000);
            expect(schedules[0].template?.opts).toMatchObject({
                attempts: 1,
                removeOnComplete: { count: 1000 },
                removeOnFail: { count: 1000 },
            });

            const tickJob = (
                await queueA.getJobs(["delayed", "waiting"])
            ).find(({ name }) => name === NOTIFICATIONS_RELAY_TICK_JOB_NAME);
            expect(tickJob).toBeDefined();
            const processor = new NotificationsQueueProcessor(
                { projectEvent } as any,
                { relayTick } as any,
            );
            worker = new Worker(
                NOTIFICATIONS_QUEUE_NAME,
                (job) => processor.process(job),
                { connection, prefix },
            );
            await worker.waitUntilReady();
            await tickJob!.waitUntilFinished(events, 10000);
            expect(relayTick).toHaveBeenCalled();
            expect(projectEvent).not.toHaveBeenCalled();
            expect(
                (await queueA.getJobSchedulers()).filter(
                    ({ key }) => key === NOTIFICATIONS_RELAY_SCHEDULER_ID,
                ),
            ).toHaveLength(1);

            const outboxJob = await queueA.add(
                NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
                { eventId: "scheduled-test-event", attemptToken: "token" },
                { attempts: 1 },
            );
            await outboxJob.waitUntilFinished(events, 10000);
            expect(projectEvent).toHaveBeenCalledWith(
                "scheduled-test-event",
                "token",
            );
        } finally {
            await worker?.close();
            await events.close();
            await queueA.removeJobScheduler(NOTIFICATIONS_RELAY_SCHEDULER_ID);
            await queueA.obliterate({ force: true });
            await Promise.all([queueA.close(), queueB.close()]);
        }
    });
});
