import { Queue, QueueEvents, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { IgdbLegacyDrainService } from "../../src/sync/igdb/catalog/igdb-legacy-drain.service";
import { IgdbSyncService } from "../../src/sync/igdb/igdb-sync.service";
import { IGDB_SYNC_QUEUE_NAME } from "../../src/sync/igdb/igdb-sync.constants";
import { catalogConfig } from "../../src/sync/igdb/catalog/igdb-catalog.config";
import { testEnvironment } from "./helpers/test-environment";

describe("local legacy cutover and rollback", () => {
    it("enqueues, drains, rejects internal-mode pushes, and restores legacy after settlement", async () => {
        const settings = testEnvironment(process.env);
        const prefix = `${settings.prefix}-${randomUUID()}`;
        const queue = new Queue(IGDB_SYNC_QUEUE_NAME, {
            connection: settings.redis,
            prefix,
        });
        const events = new QueueEvents(IGDB_SYNC_QUEUE_NAME, {
            connection: settings.redis,
            prefix,
        });
        let worker: Worker | undefined;
        const config = catalogConfig({});
        const service = new IgdbSyncService(queue, config);
        const drain = new IgdbLegacyDrainService(queue);
        try {
            await events.waitUntilReady();
            await service.registerUpdateJob([{ id: 1, updated_at: 1 }]);
            expect(await drain.isDrained()).toBe(false);
            const [job] = await queue.getWaiting();
            const finished = job.waitUntilFinished(events, 5000);
            config.enabled = true;
            await expect(
                service.registerUpdateJob([{ id: 2, updated_at: 1 }]),
            ).rejects.toMatchObject({ status: 409 });
            expect(await queue.getWaitingCount()).toBe(1);
            worker = new Worker(IGDB_SYNC_QUEUE_NAME, async () => undefined, {
                connection: settings.redis,
                prefix,
            });
            await finished;
            await worker.close();
            worker = undefined;
            expect(await drain.isDrained()).toBe(true);
            // Only restore the producer after the internal/legacy worker is settled.
            config.enabled = false;
            await service.registerUpdateJob([{ id: 3, updated_at: 1 }]);
            expect(await queue.getWaitingCount()).toBe(1);
        } finally {
            await worker?.close();
            await queue.obliterate({ force: true });
            await Promise.all([events.close(), queue.close()]);
        }
    });
});
