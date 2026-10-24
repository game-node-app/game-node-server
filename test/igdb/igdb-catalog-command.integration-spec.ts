import { IGDB_SYNC_QUEUE_NAME } from "../../src/sync/igdb/igdb-sync.constants";
import { DataSource } from "typeorm";
import { Queue, QueueEvents, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { catalogCommand } from "../../scripts/igdb-catalog";
import { IgdbCatalogState } from "../../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import { CreateIgdbCatalogState1792857600000 } from "../../src/migrations/1792857600000-CreateIgdbCatalogState";
import {
    IGDB_CATALOG_QUEUE_NAME,
    catalogJobId,
} from "../../src/sync/igdb/catalog/igdb-catalog.constants";
import { testEnvironment } from "./helpers/test-environment";

describe("local operator commands without application bootstrap", () => {
    const env = {
        ...process.env,
        IGDB_CATALOG_ENABLED: "true",
        IGDB_TEST_QUEUE_PREFIX: `igdb-test-command-${randomUUID()}`,
    };
    const settings = testEnvironment(env);
    let source: DataSource;
    let queue: Queue;
    const runId = randomUUID();
    let acknowledgedRunId: string | undefined;
    beforeAll(async () => {
        source = await new DataSource({
            ...settings.mysql,
            timezone: "Z",
            entities: [IgdbCatalogState],
            migrations: [CreateIgdbCatalogState1792857600000],
            migrationsTableName: "igdb_test_migrations",
        }).initialize();
        await source.undoLastMigration();
        await source.runMigrations();
        await source.getRepository(IgdbCatalogState).update(1, {
            status: "paused",
            runId,
            committedId: 7,
            upperId: 100,
            attempt: 3,
            retryStage: "game",
            retryGameId: 8,
            retryBudgets: { "game:8": 3 },
            failureSummary: "Fixture invalid game",
            ownerToken: null,
            leaseExpiresAt: null,
        });
        queue = new Queue(IGDB_CATALOG_QUEUE_NAME, {
            connection: settings.redis,
            prefix: settings.prefix,
        });
    });
    afterAll(async () => {
        const job = await queue?.getJob(catalogJobId(runId));
        if (job) await job.remove();
        if (acknowledgedRunId)
            await (
                await queue.getJob(catalogJobId(acknowledgedRunId))
            )?.remove();
        await queue?.close();
        if (source?.isInitialized) await source.destroy();
    });
    it("reports cursor/error without scheduling a job and resumes the same run", async () => {
        const status = await catalogCommand(["status", "--local"], env);
        expect(status).toMatchObject({
            status: "paused",
            runId,
            committedId: 7,
            upperId: 100,
            attempt: 3,
            failureSummary: "Fixture invalid game",
        });
        expect(await queue.getWaitingCount()).toBe(0);
        const resumed = await catalogCommand(["resume", "--local"], env);
        expect(resumed).toMatchObject({
            status: "running",
            runId,
            committedId: 7,
            upperId: 100,
            attempt: 0,
        });
        expect((await queue.getJob(catalogJobId(runId)))?.data).toEqual({
            runId,
        });
    });
    it("acknowledges retained legacy failures before an initial run exists", async () => {
        await (await queue.getJob(catalogJobId(runId)))?.remove();
        await source.getRepository(IgdbCatalogState).update(1, {
            status: "idle",
            runId: null,
            committedId: 0,
            upperId: null,
            nextEligibleAt: null,
            ownerToken: null,
            leaseExpiresAt: null,
        });
        const legacy = new Queue(IGDB_SYNC_QUEUE_NAME, {
            connection: settings.redis,
            prefix: settings.prefix,
        });
        const events = new QueueEvents(IGDB_SYNC_QUEUE_NAME, {
            connection: settings.redis,
            prefix: settings.prefix,
        });
        const worker = new Worker(
            IGDB_SYNC_QUEUE_NAME,
            async () => {
                throw new Error("Retained fixture failure");
            },
            { connection: settings.redis, prefix: settings.prefix },
        );
        try {
            await events.waitUntilReady();
            const job = await legacy.add(
                "fixture",
                { id: 1 },
                { removeOnFail: false },
            );
            await expect(job.waitUntilFinished(events, 5000)).rejects.toThrow(
                "Retained fixture failure",
            );
            await worker.close();
            const acknowledged = await catalogCommand(
                ["resume", "--local", "--acknowledge-legacy-failures"],
                env,
            );
            expect(acknowledged.status).toBe("running");
            acknowledgedRunId = acknowledged.runId as string;
            expect(acknowledgedRunId).not.toBe(runId);
            expect(
                (await queue.getJob(catalogJobId(acknowledgedRunId)))?.data,
            ).toEqual({ runId: acknowledgedRunId });
        } finally {
            await worker.close();
            await legacy.obliterate({ force: true });
            await Promise.all([events.close(), legacy.close()]);
        }
    });

    it("exits nonzero for invalid commands without opening services", () => {
        const child = spawnSync(
            process.execPath,
            ["-r", "ts-node/register", "scripts/igdb-catalog.ts", "invalid"],
            { cwd: process.cwd(), encoding: "utf8", timeout: 15000 },
        );
        expect(child.status).toBe(1);
        expect(child.stderr).toContain("command failed");
    }, 20000);
});
