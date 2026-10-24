import { DataSource } from "typeorm";
import { Queue } from "bullmq";
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
        IGDB_TEST_QUEUE_PREFIX: `igdb-test-command-${randomUUID()}`,
    };
    const settings = testEnvironment(env);
    let source: DataSource;
    let queue: Queue;
    const runId = randomUUID();
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
