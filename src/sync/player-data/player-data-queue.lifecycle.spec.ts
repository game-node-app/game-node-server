import { PlayerDataProcessor } from "./player-data.processor";
import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { PlayerSyncStateService } from "./player-sync-state.service";
import { playerOwner } from "./player-sync.fixture";
import {
    PLAYER_DATA_JOB as IMPORTER_WATCH_JOB_NAME,
    PLAYER_DATA_QUEUE as IMPORTER_WATCH_QUEUE_NAME,
} from "./player-data.constants";
import { UserPlaytimeSource as EImporterSource } from "../../playtime/playtime.constants";
const redisDescribe = process.env.PLAYER_IMPORT_TEST_REDIS_PORT
    ? describe
    : describe.skip;
redisDescribe("full refresh Redis lifecycle", () => {
    const connection = {
        host: "127.0.0.1",
        port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
        maxRetriesPerRequest: null,
    };
    const prefix = `player-import-test-${randomUUID()}`;
    let queue: Queue;
    let worker: Worker | undefined;
    let admission: PlayerSyncStateService;
    const admit = (owner = playerOwner("test-user")) =>
        admission.enqueue(owner, queue, IMPORTER_WATCH_JOB_NAME, {
            userId: "test-user",
            source: EImporterSource.STEAM,
        });

    beforeEach(() => {
        admission = new PlayerSyncStateService({} as any);
        jest.spyOn(admission, "assertCurrent").mockResolvedValue(undefined);
        queue = new Queue(IMPORTER_WATCH_QUEUE_NAME, {
            connection,
            prefix,
            defaultJobOptions: {
                removeOnComplete: { age: 3600, count: 1000 },
                removeOnFail: { age: 604800, count: 2 },
            },
        });
    });

    afterEach(async () => {
        await worker?.close();
        worker = undefined;
        await queue.obliterate();
        await queue.close();
    });

    it("deduplicates waiting and active jobs, then admits a new run with retained completion", async () => {
        const owner = playerOwner("test-user");
        await Promise.all([admit(owner), admit(owner)]);
        const waiting = await queue.getWaiting();
        expect(waiting).toHaveLength(1);
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        worker = new Worker(IMPORTER_WATCH_QUEUE_NAME, () => pending, {
            connection,
            prefix,
        });
        await new Promise<void>((resolve) =>
            worker!.once("active", () => resolve()),
        );
        await admit(owner);
        expect(await queue.getWaitingCount()).toBe(0);
        const completed = new Promise<void>((resolve) =>
            worker!.once("completed", () => resolve()),
        );
        release();
        await completed;
        await worker.pause();
        expect(await queue.getCompletedCount()).toBe(1);
        await admit();
        const next = await queue.getWaiting();
        expect(next).toHaveLength(1);
        expect(next[0].id).not.toBe(waiting[0].id);
        const finished = new Promise<void>((resolve) =>
            worker!.once("completed", () => resolve()),
        );
        worker.resume();
        await finished;
        expect(await queue.getCompletedCount()).toBe(2);
    });

    it("bounds retained failures and releases deduplication for later runs", async () => {
        worker = new Worker(
            IMPORTER_WATCH_QUEUE_NAME,
            async () => {
                throw new Error("fixture failure");
            },
            { connection, prefix },
        );
        await worker.waitUntilReady();
        for (let i = 0; i < 4; i++) {
            const failed = new Promise<void>((resolve) =>
                worker!.once("failed", () => resolve()),
            );
            await admit();
            await failed;
        }
        expect(await queue.getFailedCount()).toBe(2);
    });
    it("rejects an old payload before any provider work and does not retry it", async () => {
        const runOwned = jest.fn();
        const processor = new PlayerDataProcessor(
            { runOwned } as any,
            {} as any,
            {} as any,
        );
        worker = new Worker(
            IMPORTER_WATCH_QUEUE_NAME,
            (job) => processor.process(job as any),
            { connection, prefix },
        );
        await worker.waitUntilReady();
        const failed = new Promise<void>((resolve) =>
            worker!.once("failed", () => resolve()),
        );
        const job = await queue.add(
            IMPORTER_WATCH_JOB_NAME,
            { userId: "legacy", source: "steam" },
            { attempts: 5 },
        );
        await failed;
        const terminal = await queue.getJob(job.id!);
        expect(await terminal!.getState()).toBe("failed");
        expect(terminal!.attemptsMade).toBe(1);
        expect(runOwned).not.toHaveBeenCalled();
    });
});
