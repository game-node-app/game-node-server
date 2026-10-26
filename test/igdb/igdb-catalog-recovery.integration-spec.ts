import { randomBytes } from "node:crypto";
import { IgdbCatalogState } from "../../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import { fork, ChildProcess } from "node:child_process";
import { once } from "node:events";
import { QueueEvents } from "bullmq";
import { fixtureRuntime } from "./helpers/fixture-runtime";
import { fixtureExpected } from "./helpers/generated-catalog";
import {
    CATALOG_JOB_OPTIONS,
    IGDB_CATALOG_JOB_NAME,
    catalogJobId,
} from "../../src/sync/igdb/catalog/igdb-catalog.constants";
import { Game } from "../../src/game/game-repository/entities/game.entity";
import { StatisticsTarget } from "../../src/statistics/entity/statistics-target.entity";
import { MetricTotal } from "../../src/statistics/entity/metric-total.entity";
import { StatisticsSourceType } from "../../src/statistics/statistics.constants";

function message(
    child: ChildProcess,
    type: string,
    timeoutMs = 25000,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Recovery worker did not report ${type}`));
        }, timeoutMs);
        const listener = (value: any) => {
            if (value.type === type) {
                cleanup();
                resolve();
            }
        };
        const exit = () => {
            cleanup();
            reject(new Error(`Recovery worker exited before ${type}`));
        };
        const cleanup = () => {
            clearTimeout(timer);
            child.off("message", listener);
            child.off("exit", exit);
        };
        child.on("message", listener);
        child.on("exit", exit);
    });
}
async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    if (child.connected) {
        child.send("release");
        child.send("stop");
    }
    const deadline = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
        await exited;
    } finally {
        clearTimeout(deadline);
    }
}

describe("two-process durable catalog recovery", () => {
    it.each(["kill", "stale"])(
        "recovers after game commit/before checkpoint (%s owner)",
        async (mode) => {
            const fixture = { seed: 42, games: 4 };
            const runtime = await fixtureRuntime(fixture, {
                trackPages: false,
                tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
            });
            const children: ChildProcess[] = [];
            const events = new QueueEvents(runtime.queue.name, {
                connection: runtime.settings.redis,
                prefix: runtime.settings.prefix,
            });
            const launch = async (fault: string) => {
                const child = fork("test/igdb/helpers/catalog-worker.ts", [], {
                    execArgv: ["-r", "ts-node/register"],
                    env: {
                        ...process.env,
                        IGDB_TEST_QUEUE_PREFIX: runtime.settings.prefix,
                        IGDB_WORKER_SOURCE_URL: runtime.endpoint,
                        IGDB_TEST_TABLE_PREFIX:
                            runtime.source.options.entityPrefix,
                        IGDB_WORKER_FAULT: fault,
                    },
                    stdio: ["ignore", "inherit", "inherit", "ipc"],
                });
                children.push(child);
                await message(child, "ready");
                return child;
            };
            try {
                await events.waitUntilReady();
                await runtime.queue.setGlobalConcurrency(1);
                const claim = await runtime.state.claimRun();
                await runtime.state.releaseOwnership(claim as any);
                const first = await launch("hold");
                const held = message(first, "beforeCheckpoint");
                const job = await runtime.queue.add(
                    IGDB_CATALOG_JOB_NAME,
                    { runId: claim!.runId },
                    {
                        ...CATALOG_JOB_OPTIONS,
                        jobId: catalogJobId(claim!.runId!),
                    },
                );
                await held;
                expect((await runtime.state.readStatus()).committedId).toBe(0);
                const existingGame = await runtime.source.getRepository(Game).findOneByOrFail({ id: 45 });
                await runtime.source.getRepository(MetricTotal).upsert({
                    targetId: existingGame.statisticsTargetId!,
                    metricCode: "views",
                    metricValue: 11,
                }, ["targetId", "metricCode"]);
                if (mode === "kill") {
                    const dead = once(first, "exit");
                    first.kill("SIGKILL");
                    await dead;
                }
                await runtime.source.query(
                    `UPDATE \`${runtime.source.getMetadata(IgdbCatalogState).tableName}\` SET leaseExpiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = 1`,
                );
                await (
                    await runtime.queue.client
                ).del(`${runtime.queue.toKey(job.id!)}:lock`);
                const completed = job.waitUntilFinished(events, 25000);
                await launch("none");
                await completed;
                if (mode === "stale") {
                    first.send("release");
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 300),
                    );
                }
                const status = await runtime.state.readStatus();
                expect(status).toMatchObject({
                    status: "completed",
                    committedId: fixtureExpected(fixture).cursor,
                    committedGames: 4,
                    committedBatches: 1,
                });
                expect(await runtime.source.getRepository(Game).count()).toBe(
                    5,
                );
                expect(
                    await runtime.source.getRepository(StatisticsTarget).countBy({ sourceType: StatisticsSourceType.GAME }),
                ).toBe(5);
                expect(
                    (
                        await runtime.source
                            .getRepository(MetricTotal)
                            .findOneByOrFail({ targetId: existingGame.statisticsTargetId!, metricCode: "views" })
                    ).metricValue,
                ).toBe(11);
                const game = await runtime.source
                    .getRepository(Game)
                    .findOneOrFail({
                        where: { id: 45 },
                        relations: { dlcs: true },
                    });
                expect(game.dlcs).toHaveLength(1);
                expect(
                    Number(
                        await (
                            await runtime.queue.client
                        ).get(`${runtime.settings.prefix}:max-writers`),
                    ),
                ).toBe(1);
            } finally {
                await Promise.all(children.map(stop));
                await runtime.queue.obliterate({ force: true });
                await events.close();
                await runtime.close();
            }
        },
        60000,
    );

    it.each(["checkpoint", "invalid", "redis"])(
        "pauses safely on %s failure and completes only after explicit correction/resume",
        async (fault) => {
            const runtime = await fixtureRuntime(
                { seed: 42, games: 4 },
                {
                    trackPages: false,
                    tablePrefix: `r_${randomBytes(4).toString("hex")}_`,
                },
            );
            if (fault === "invalid") runtime.setInvalidGame(48);
            const child = fork("test/igdb/helpers/catalog-worker.ts", [], {
                execArgv: ["-r", "ts-node/register"],
                env: {
                    ...process.env,
                    IGDB_TEST_QUEUE_PREFIX: runtime.settings.prefix,
                    IGDB_WORKER_SOURCE_URL: runtime.endpoint,
                    IGDB_TEST_TABLE_PREFIX: runtime.source.options.entityPrefix,
                    IGDB_WORKER_FAULT: fault,
                },
                stdio: ["ignore", "inherit", "inherit", "ipc"],
            });
            const events = new QueueEvents(runtime.queue.name, {
                connection: runtime.settings.redis,
                prefix: runtime.settings.prefix,
            });
            try {
                await message(child, "ready");
                await events.waitUntilReady();
                const claim = await runtime.state.claimRun();
                await runtime.state.releaseOwnership(claim as any);
                const failed = message(child, "failed");
                const job = await runtime.queue.add(
                    IGDB_CATALOG_JOB_NAME,
                    { runId: claim!.runId },
                    {
                        ...CATALOG_JOB_OPTIONS,
                        jobId: catalogJobId(claim!.runId!),
                    },
                );
                await failed;
                const paused = await runtime.state.readStatus();
                expect(paused.status).toBe("paused");
                expect(paused.committedId).toBe(fault === "redis" ? 54 : 0);
                expect(paused.attempt).toBeGreaterThanOrEqual(1);
                expect(paused.attempt).toBeLessThanOrEqual(3);
                expect(await runtime.state.claimRun()).toBeNull();
                runtime.setInvalidGame(null);
                if (fault === "redis") {
                    const corrected = message(child, "corrected");
                    child.send("correct");
                    await corrected;
                }
                await runtime.state.resumeRun();
                await job.retry();
                await job.waitUntilFinished(events, 15000);
                expect(await runtime.state.readStatus()).toMatchObject({
                    status: "completed",
                    committedId: 54,
                    committedGames: 4,
                });
                expect(
                    await runtime.source.getRepository(StatisticsTarget).countBy({ sourceType: StatisticsSourceType.GAME }),
                ).toBe(5);
            } finally {
                await stop(child);
                await runtime.queue.obliterate({ force: true });
                await events.close();
                await runtime.close();
            }
        },
        60000,
    );
});
