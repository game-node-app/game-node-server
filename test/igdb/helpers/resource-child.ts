import { QueueEvents, Worker } from "bullmq";
import { mkdir, writeFile } from "node:fs/promises";
import { fixtureRuntime } from "./fixture-runtime";
import { fixtureExpected } from "./generated-catalog";
import {
    CATALOG_JOB_OPTIONS,
    IGDB_CATALOG_JOB_NAME,
    catalogJobId,
} from "../../../src/sync/igdb/catalog/igdb-catalog.constants";
import { Game } from "../../../src/game/game-repository/entities/game.entity";
import { GameStatistics } from "../../../src/statistics/entity/game-statistics.entity";
import { GameCover } from "../../../src/game/game-repository/entities/game-cover.entity";

async function main() {
    const pages = Number(process.env.IGDB_FIXTURE_PAGES);
    const seed = 42;
    if (![100, 1000].includes(pages))
        throw new Error("Resource child requires 100 or 1000 pages");
    const fixture = { seed, games: pages * 25 };
    const started = Date.now();
    const memory = {
        samples: 0,
        warmupRss: 0,
        warmupHeap: 0,
        peakRss: 0,
        peakHeap: 0,
        peakRedis: 0,
    };
    const runtime = await fixtureRuntime(fixture, {
        onBatch: async (count) => {
            if (count % 10) return;
            const usage = process.memoryUsage();
            const redis = await runtime.queue.client;
            const used = Number(
                /used_memory:(\d+)/.exec(await redis.info("memory"))?.[1] ?? 0,
            );
            if (!memory.samples) {
                memory.warmupRss = usage.rss;
                memory.warmupHeap = usage.heapUsed;
            }
            memory.samples++;
            memory.peakRss = Math.max(memory.peakRss, usage.rss);
            memory.peakHeap = Math.max(memory.peakHeap, usage.heapUsed);
            memory.peakRedis = Math.max(memory.peakRedis, used);
            const counts = await runtime.queue.getJobCounts(
                "waiting",
                "active",
                "delayed",
                "waiting-children",
            );
            if (Object.values(counts).reduce((a, b) => a + b, 0) > 1)
                throw new Error("Orchestration backlog grew");
            if (count % 100 === 0)
                process.stdout.write(
                    `fixture ${pages} pages: committed ${count}\n`,
                );
        },
    });
    const connection = runtime.settings.redis;
    const prefix = runtime.settings.prefix;
    const events = new QueueEvents(runtime.queue.name, { connection, prefix });
    let worker: Worker | undefined;
    const assert = (condition: boolean, message: string) => {
        if (!condition) throw new Error(message);
    };
    try {
        await events.waitUntilReady();
        await runtime.queue.setGlobalConcurrency(1);
        worker = new Worker(
            runtime.queue.name,
            async (job) => {
                assert(
                    Object.keys(job.data).join() === "runId",
                    "Job payload contains more than runId",
                );
                await runtime.runner.run(job.data.runId);
            },
            { connection, prefix, concurrency: 1 },
        );
        const claim = await runtime.state.claimRun();
        if (!claim) throw new Error("Fixture run not claimable");
        await runtime.state.releaseOwnership(claim as any);
        const job = await runtime.queue.add(
            IGDB_CATALOG_JOB_NAME,
            { runId: claim.runId },
            { ...CATALOG_JOB_OPTIONS, jobId: catalogJobId(claim.runId!) },
        );
        await job.waitUntilFinished(events, 1800000);
        await worker.close();
        worker = undefined;
        const status = await runtime.state.readStatus();
        const expected = fixtureExpected(fixture);
        assert(
            status.status === "completed" &&
                status.committedId === expected.cursor &&
                status.committedGames === fixture.games &&
                status.committedBatches === pages,
            "Final durable progress does not match fixture formulas",
        );
        assert(
            runtime.bounds.maxPages === 1 &&
                runtime.bounds.maxGames <= 1 &&
                runtime.bounds.maxRelations <= 2,
            "Processing bounds exceeded",
        );
        assert(runtime.statisticsJobs() === 0, "Statistics backlog grew");
        assert(
            (await runtime.source.getRepository(Game).count()) ===
                expected.gameRows,
            "Unexpected game row count",
        );
        assert(
            (await runtime.source.getRepository(GameStatistics).count()) ===
                expected.statisticsRows,
            "Unexpected statistics row count",
        );
        assert(
            (await runtime.source.getRepository(GameCover).count()) ===
                expected.covers,
            "Unexpected nested image count",
        );
        let recovered = false;
        worker = new Worker(
            runtime.queue.name,
            async (job) => {
                assert(
                    Object.keys(job.data).join() === "runId",
                    "Retention job is not identifier-only",
                );
                if (job.data.runId.endsWith("-failed")) {
                    if (job.data.runId === "retention-0-failed" && recovered)
                        return;
                    throw new Error("Controlled retention failure");
                }
            },
            { connection, prefix, concurrency: 1 },
        );
        for (let index = 0; index < 25; index++) {
            const runId = `retention-${index}-${index % 2 ? "complete" : "failed"}`;
            const retained = await runtime.queue.add(
                IGDB_CATALOG_JOB_NAME,
                { runId },
                { ...CATALOG_JOB_OPTIONS, jobId: catalogJobId(runId) },
            );
            try {
                await retained.waitUntilFinished(events, 10000);
            } catch {
                if (index % 2) throw new Error("Unexpected retention failure");
            }
            if (index === 0) {
                recovered = true;
                await retained.retry();
                await retained.waitUntilFinished(events, 10000);
            }
        }
        await worker.close();
        worker = undefined;
        const counts = await runtime.queue.getJobCounts(
            "completed",
            "failed",
            "waiting",
            "active",
            "delayed",
            "waiting-children",
        );
        assert(
            counts.completed <= 10 &&
                counts.failed <= 10 &&
                counts.waiting +
                    counts.active +
                    counts.delayed +
                    counts["waiting-children"] ===
                    0,
            "Queue retention is unbounded",
        );
        const report = {
            node: process.version,
            fixture: { ...fixture, pages, batchSize: 25 },
            limits: { livePages: 1, games: 1, relationships: 2 },
            observed: {
                pages: runtime.bounds.maxPages,
                games: runtime.bounds.maxGames,
                relationships: runtime.bounds.maxRelations,
            },
            expected,
            memory,
            elapsedMs: Date.now() - started,
            retentionRuns: 25,
            queueCounts: counts,
            assertions: {
                onePage: true,
                gameBound: true,
                relationshipBound: true,
                identifiersOnly: true,
                unresolvedJobBound: true,
                statisticsJobs: runtime.statisticsJobs(),
                finalProgress: true,
                retention: true,
            },
        };
        await mkdir(".tmp/igdb-sync", { recursive: true });
        const path = `.tmp/igdb-sync/resources-${pages}.json`;
        await writeFile(path, JSON.stringify(report, null, 2));
        process.stdout.write(`Resource assertions passed: ${path}\n`);
        await runtime.queue.obliterate({ force: true });
    } finally {
        await worker?.close();
        await events.close();
        await runtime.close();
    }
}
main().catch((error) => {
    process.stderr.write(
        `Local IGDB resource check failed: ${error.message}\nStart services with corepack yarn test:igdb:services:up.\n`,
    );
    process.exitCode = 1;
});
