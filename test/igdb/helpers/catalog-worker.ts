import { Worker } from "bullmq";
import { fixtureRuntime } from "./fixture-runtime";
import { CatalogDataError } from "../../../src/sync/igdb/catalog/igdb-catalog.client";

async function main() {
    const prefix = process.env.IGDB_TEST_QUEUE_PREFIX!;
    const fault = process.env.IGDB_WORKER_FAULT;
    let release: (() => void) | undefined;
    let injected = false;
    const runtime = await fixtureRuntime(
        { seed: 42, games: 4 },
        {
            prefix,
            reset: false,
            sourceUrl: process.env.IGDB_WORKER_SOURCE_URL,
            verifyRedis: true,
            beforeCheckpoint: async () => {
                if (injected) return;
                if (fault === "hold") {
                    injected = true;
                    await new Promise<void>((resolve) => {
                        release = resolve;
                        process.send?.({ type: "beforeCheckpoint" });
                    });
                } else if (fault === "checkpoint") {
                    injected = true;
                    throw new CatalogDataError("Controlled checkpoint failure");
                }
            },
            onBatch: async () => {
                if (fault === "redis" && !injected) {
                    injected = true;
                    (await runtime.budgetQueue.client).disconnect();
                }
            },
        },
    );
    const transaction = runtime.state.gameTransaction.bind(runtime.state);
    runtime.state.gameTransaction = (owner, work) =>
        transaction(owner, async (manager) => {
            const redis = await runtime.queue.client;
            const count = Number(
                await redis.eval(
                    "local n=redis.call('INCR',KEYS[1]); local m=tonumber(redis.call('GET',KEYS[2]) or '0'); if n>m then redis.call('SET',KEYS[2],n) end; return n",
                    2,
                    `${prefix}:writers`,
                    `${prefix}:max-writers`,
                ),
            );
            try {
                if (count > 1) throw new Error("Overlapping game writers");
                return await work(manager);
            } finally {
                await redis.decr(`${prefix}:writers`);
            }
        });
    const worker = new Worker(
        runtime.queue.name,
        async (job) => runtime.runner.run(job.data.runId),
        {
            connection: runtime.settings.redis,
            prefix,
            concurrency: 1,
            lockDuration: 1000,
            stalledInterval: 200,
            maxStalledCount: 3,
        },
    );
    worker.on("error", () => process.send?.({ type: "workerError" }));
    worker.on("completed", () => process.send?.({ type: "completed" }));
    worker.on("failed", () => process.send?.({ type: "failed" }));
    await worker.waitUntilReady();
    process.on("message", (message) => {
        if (message === "release") release?.();
        if (message === "correct")
            void (async () => {
                const redis = await runtime.budgetQueue.client;
                if (redis.status === "end") await redis.connect();
                process.send?.({ type: "corrected" });
            })();
        if (message === "stop")
            void (async () => {
                release?.();
                await runtime.runner.onModuleDestroy();
                await worker.close();
                await runtime.close();
                process.disconnect?.();
            })().catch(() => {
                process.exitCode = 1;
                process.disconnect?.();
            });
    });
    process.send?.({ type: "ready" });
}
main().catch((error) => {
    process.stderr.write(`Local recovery worker failed: ${error.message}\n`);
    process.exitCode = 1;
    process.disconnect?.();
});
