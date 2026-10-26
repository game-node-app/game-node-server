import "reflect-metadata";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createKeyv } from "@keyv/redis";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../test/notifications/notification-test-harness";
import { StatisticsViewRequestDto } from "../src/statistics/dto/statistics-api.dto";
import { StatisticsSourceType } from "../src/statistics/statistics.constants";
import { StatisticsProjectionService } from "../src/statistics/statistics-projection.service";
import { StatisticsRankingService } from "../src/statistics/statistics-ranking.service";
import { StatisticsService } from "../src/statistics/statistics.service";
import { testEnvironment } from "../test/igdb/helpers/test-environment";

const targetCount = 100_000;
const eventCount = 1_000_000;
const seedBatchSize = 5_000;
const projectionBatchSize = 200;
const workloadSeconds = 300;
const viewRate = 20;
const reactionRate = 1;
const pauseFromSeconds = 120;
const pauseUntilSeconds = 135;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(samples: number[], percent: number): number {
    if (!samples.length) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    return Number(sorted[Math.ceil((percent / 100) * sorted.length) - 1].toFixed(2));
}

async function explain(source: DataSource, query: string, parameters: unknown[] = []) {
    return source.query(`EXPLAIN ${query}`, parameters);
}

async function seed(source: DataSource, runId: string) {
    await source.query("SET FOREIGN_KEY_CHECKS = 0");
    await source.query("TRUNCATE TABLE statistics_event");
    await source.query("TRUNCATE TABLE metric_total");
    await source.query("TRUNCATE TABLE metric_hour");
    await source.query("TRUNCATE TABLE ranking_score");
    await source.query("TRUNCATE TABLE engagement_state");
    await source.query("TRUNCATE TABLE game_genres_game_genre");
    await source.query("TRUNCATE TABLE game");
    await source.query("TRUNCATE TABLE statistics_target");
    await source.query("TRUNCATE TABLE profile");
    await source.query("SET FOREIGN_KEY_CHECKS = 1");
    await source.query("INSERT INTO game (id, name, slug) VALUES (1, 'Notification fixture', 'notification-fixture')");

    const targetStartedAt = performance.now();
    const [maxGame] = await source.query("SELECT COALESCE(MAX(id), 0) AS maxId FROM game");
    const firstGameId = Number(maxGame.maxId) + 1000;
    assert(Number.isSafeInteger(firstGameId + targetCount - 1), "game source IDs must remain safe integers");
    let firstTargetId = 0;

    for (let offset = 0; offset < targetCount; offset += seedBatchSize) {
        const size = Math.min(seedBatchSize, targetCount - offset);
        await source.transaction(async (manager) => {
            const targets = Array.from({ length: size }, () => "('game', 1)").join(",");
            const inserted = await manager.query(
                `INSERT INTO statistics_target (sourceType, isActive) VALUES ${targets}`,
            );
            const targetStart = Number(inserted.insertId);
            if (!firstTargetId) firstTargetId = targetStart;
            const gameValues: string[] = [];
            const gameParams: Array<string | number> = [];
            const gaugeValues: string[] = [];
            const gaugeParams: number[] = [];
            for (let index = 0; index < size; index++) {
                const gameId = firstGameId + offset + index;
                const targetId = targetStart + index;
                gameValues.push("(?, ?, ?, ?)");
                gameParams.push(gameId, `Workload ${runId.slice(0, 8)} ${offset + index}`, `statistics-${runId}-${gameId}`, targetId);
                gaugeValues.push("(?, 'likes_current', 0)");
                gaugeParams.push(targetId);
            }
            await manager.query(
                `INSERT INTO game (id, name, slug, statisticsTargetId) VALUES ${gameValues.join(",")}`,
                gameParams,
            );
            await manager.query(
                `INSERT INTO metric_total (targetId, metricCode, metricValue) VALUES ${gaugeValues.join(",")}`,
                gaugeParams,
            );
        });
        if (offset % 10_000 === 0) process.stdout.write(`seeded targets ${offset + size}/${targetCount}\n`);
    }

    const [maxGenre] = await source.query("SELECT COALESCE(MAX(id), 0) AS maxId FROM game_genre");
    const genreId = Number(maxGenre.maxId) + 1;
    await source.query("INSERT INTO game_genre (id, name, slug) VALUES (?, 'Workload Genre', ?)", [genreId, `workload-${runId}`]);
    const boundaryValues: string[] = [];
    const boundaryParams: number[] = [];
    for (let index = targetCount - 100; index < targetCount; index++) {
        boundaryValues.push("(?, ?)");
        boundaryParams.push(firstGameId + index, genreId);
    }
    await source.query(
        `INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES ${boundaryValues.join(",")}`,
        boundaryParams,
    );

    const actorIds = Array.from({ length: 8 }, () => randomUUID());
    const profileValues = actorIds.map((id, index) => "(?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").join(",");
    const profileParams = actorIds.flatMap((id, index) => [id, `w_${runId.slice(0, 8)}_${index}`]);
    await source.query(
        `INSERT INTO profile (userId, username, createdAt, updatedAt) VALUES ${profileValues}`,
        profileParams,
    );

    const eventStartedAt = performance.now();
    for (let start = 0; start < eventCount; start += seedBatchSize) {
        const size = Math.min(seedBatchSize, eventCount - start);
        const values = Array.from(
            { length: size },
            () => "(?, 1, 'view.recorded', ?, CURRENT_TIMESTAMP(6), 'live', 0, 'done', 0, CURRENT_TIMESTAMP(6))",
        ).join(",");
        const parameters: Array<string | number> = [];
        for (let index = 0; index < size; index++) {
            const factNumber = start + index;
            const targetOffset = factNumber < 10_000
                ? Math.floor(factNumber / 100)
                : 100 + Math.floor((factNumber - 10_000) / 10);
            parameters.push(`workload:${runId}:${factNumber}`, firstTargetId + targetOffset);
        }
        await source.query(
            `INSERT INTO statistics_event
             (eventKey, eventVersion, eventKind, targetId, occurredAt, provenance, firstLikeCredit, projectionState, attempts, nextAttemptAt)
             VALUES ${values}`,
            parameters,
        );
        if (start % 100_000 === 0) process.stdout.write(`seeded events ${start + size}/${eventCount}\n`);
    }
    await source.query(
        `INSERT INTO metric_total (targetId, metricCode, metricValue)
         SELECT targetId, 'views', COUNT(*) FROM statistics_event WHERE eventKey LIKE ? GROUP BY targetId
         ON DUPLICATE KEY UPDATE metricValue = VALUES(metricValue)`,
        [`workload:${runId}:%`],
    );
    await source.query(
        `INSERT INTO metric_hour (targetId, metricCode, bucketStart, metricValue)
         SELECT targetId, 'views', TIMESTAMP(DATE_FORMAT(occurredAt, '%Y-%m-%d %H:00:00')) AS bucketStart, COUNT(*)
         FROM statistics_event WHERE eventKey LIKE ? GROUP BY targetId, bucketStart`,
        [`workload:${runId}:%`],
    );
    const [seeded] = await source.query("SELECT COUNT(*) AS count FROM statistics_event WHERE eventKey LIKE ?", [`workload:${runId}:%`]);
    assert(Number(seeded.count) === eventCount, "seed must create exactly one million facts");
    return {
        firstGameId,
        firstTargetId,
        genreId,
        actorIds,
        targetSeedMs: Number((eventStartedAt - targetStartedAt).toFixed(2)),
        seedEventsMs: Number((performance.now() - eventStartedAt).toFixed(2)),
    };
}

export async function runStatisticsWorkload() {
    const env = testEnvironment(process.env);
    const source = await createNotificationTestDataSource();
    const runId = randomUUID();
    const cache = createKeyv(`redis://${env.redis.host}:${env.redis.port}`, {
        namespace: `statistics-workload-${runId}`,
    });
    const statistics = new StatisticsService(source);
    const projection = new StatisticsProjectionService(source);
    const rankings = new StatisticsRankingService(source, cache as any);
    const writerLatency: number[] = [];
    const readerLatency: number[] = [];
    const errors: string[] = [];
    const writerPromises = new Set<Promise<void>>();
    let peakRss = process.memoryUsage().rss;
    const memorySampler = setInterval(() => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 1000);
    let readersRunning = false;
    const readerTasks: Promise<void>[] = [];
    let maxProjectionBatch = 0;
    let projectionRunning = false;
    let rankingRefreshRunning = false;
    let rankingRefreshPromise: Promise<void> | undefined;
    let readersCount = 0;
    let reactionCount = 0;
    let latestReaction = Promise.resolve();
    let nextProjectionAt = 0;
    let nextRankingRefreshAt = 0;
    let projectionPauseMs = 0;
    let outageRecoveryMs = 0;
    const outageViewIds: string[] = [];
    const outageWrites: Promise<void>[] = [];

    function write(operation: () => Promise<unknown>): Promise<void> {
        const started = performance.now();
        let tracked: Promise<void>;
        tracked = operation()
            .then(() => { writerLatency.push(performance.now() - started); })
            .catch((error) => { errors.push(error instanceof Error ? error.message : "writer failed"); })
            .finally(() => writerPromises.delete(tracked));
        writerPromises.add(tracked);
        return tracked;
    }

    function refreshRankings(): Promise<void> {
        if (rankingRefreshPromise) return rankingRefreshPromise;
        rankingRefreshRunning = true;
        const promise: Promise<void> = rankings.refreshCommonScores()
            .then(() => undefined)
            .catch((error) => {
                errors.push(error instanceof Error ? error.message : "ranking refresh failed");
            })
            .finally(() => {
                rankingRefreshRunning = false;
                rankingRefreshPromise = undefined;
            });
        rankingRefreshPromise = promise;
        return promise;
    }

    try {
        const seeded = await seed(source, runId);
        await rankings.refreshCommonScores();
        const rankRequest = {
            sourceType: StatisticsSourceType.GAME,
            mode: "popular",
            period: "week",
            limit: 20,
            offset: 0,
        } as any;
        const coldStarted = performance.now();
        await rankings.findRankings("statistics-workload-cold", rankRequest);
        const coldRankingMs = Number((performance.now() - coldStarted).toFixed(2));
        const warmStarted = performance.now();
        await rankings.findRankings("statistics-workload-cold", rankRequest);
        const warmRankingMs = Number((performance.now() - warmStarted).toFixed(2));

        const topHotTargets = Array.from({ length: 100 }, (_, index) => seeded.firstGameId + index);
        const skewStarted = performance.now();
        const skew = await rankings.findRankings("statistics-workload-skew", {
            ...rankRequest,
            criteria: { ids: topHotTargets },
        });
        const skewRankingMs = Number((performance.now() - skewStarted).toFixed(2));
        assert(skew.pagination.total === 100 && skew.items[0].score >= 100, "skewed hot targets must rank by seeded facts");
        const boundaryStarted = performance.now();
        const boundary = await rankings.findRankings("statistics-workload-boundary", {
            ...rankRequest,
            criteria: { genres: [seeded.genreId] },
        });
        const boundaryRankingMs = Number((performance.now() - boundaryStarted).toFixed(2));
        assert(boundary.pagination.total === 100, "selective matches past the former cutoff must be counted before paging");
        assert(boundary.items.every((item: any) => item.sourceId >= seeded.firstGameId + targetCount - 100), "filter boundary rows must survive ranking pagination");

        readersRunning = true;
        for (let index = 0; index < 8; index++) {
            const actor = `statistics-workload-reader-${index}`;
            readerTasks.push((async () => {
                while (readersRunning) {
                    const started = performance.now();
                    try {
                        await rankings.findRankings(actor, { ...rankRequest, offset: index });
                        readerLatency.push(performance.now() - started);
                        readersCount++;
                    } catch (error) {
                        errors.push(error instanceof Error ? error.message : "ranking reader failed");
                    }
                    await delay(1000);
                }
            })());
        }

        const workloadStartedAt = performance.now();
        nextProjectionAt = workloadStartedAt + 5000;
        nextRankingRefreshAt = workloadStartedAt + 30_000;
        for (let tick = 0; tick < workloadSeconds * viewRate; tick++) {
            const scheduledAt = workloadStartedAt + tick * (1000 / viewRate);
            if (scheduledAt > performance.now()) await delay(scheduledAt - performance.now());
            const viewId = randomUUID();
            const view: StatisticsViewRequestDto = {
                sourceType: StatisticsSourceType.GAME,
                sourceId: seeded.firstGameId,
                viewId,
            };
            const elapsedSeconds = (performance.now() - workloadStartedAt) / 1000;
            if (elapsedSeconds >= pauseFromSeconds && elapsedSeconds < pauseUntilSeconds)
                outageViewIds.push(viewId);
            const viewWrite = write(() => statistics.recordView(undefined, view));
            if (elapsedSeconds >= pauseFromSeconds && elapsedSeconds < pauseUntilSeconds)
                outageWrites.push(viewWrite);

            if (tick % viewRate === 0) {
                const add = reactionCount++ % 2 === 0;
                latestReaction = latestReaction.catch(() => undefined).then(async () => {
                    await statistics.applyReaction(seeded.actorIds[0], {
                        sourceType: StatisticsSourceType.GAME,
                        sourceId: seeded.firstGameId,
                    } as any, add);
                });
                write(() => latestReaction.then(() => undefined));
            }

            if (performance.now() >= nextProjectionAt) {
                const paused = elapsedSeconds >= pauseFromSeconds && elapsedSeconds < pauseUntilSeconds;
                if (paused) projectionPauseMs += 5000;
                else if (!projectionRunning) {
                    projectionRunning = true;
                    void projection.drain(projectionBatchSize)
                        .then((processed) => {
                            maxProjectionBatch = Math.max(maxProjectionBatch, processed);
                            if (!outageRecoveryMs && outageViewIds.length && performance.now() >= workloadStartedAt + pauseUntilSeconds * 1000) {
                                return Promise.all(outageWrites).then(() => source.query(
                                    "SELECT COUNT(*) AS count FROM statistics_event WHERE eventKey IN (?) AND projectionState <> 'done'",
                                    [outageViewIds.map((id) => `view:${id.toLowerCase()}`)],
                                )).then(([row]) => {
                                    if (!Number(row.count))
                                        outageRecoveryMs = Number((performance.now() - workloadStartedAt - pauseUntilSeconds * 1000).toFixed(2));
                                });
                            }
                        })
                        .catch((error) => errors.push(error instanceof Error ? error.message : "projection failed"))
                        .finally(() => { projectionRunning = false; });
                }
                nextProjectionAt += 5000;
            }
            if (performance.now() >= nextRankingRefreshAt) {
                void refreshRankings();
                nextRankingRefreshAt += 30_000;
            }
        }
        await Promise.all([...writerPromises]);
        if (rankingRefreshRunning) await rankingRefreshPromise;
        if (errors.length) {
            console.error(`Workload operations failed (${errors.length}):`, errors.slice(0, 10));
        }
        assert(errors.length === 0, `workload operations failed: ${errors.slice(0, 5).join("; ")}`);
        assert(writerLatency.length === workloadSeconds * viewRate + workloadSeconds * reactionRate, "writer rate must match the five-minute acceptance workload");
        assert(outageRecoveryMs > 0 && outageRecoveryMs < 60_000, "projection outage events must recover within 60 seconds");

        const baseline = await rankings.findRankings("statistics-workload-baseline", {
            ...rankRequest,
            criteria: { ids: [seeded.firstGameId] },
            limit: 100,
        });
        const baselineScore = baseline.items[0].score;
        const canaryViewId = randomUUID();
        const canaryStart = performance.now();
        await statistics.recordView(undefined, {
            sourceType: StatisticsSourceType.GAME,
            sourceId: seeded.firstGameId,
            viewId: canaryViewId,
        });
        let visibilityMs = 0;
        while (performance.now() - canaryStart < 60_000) {
            const processed = await projection.drain(projectionBatchSize);
            maxProjectionBatch = Math.max(maxProjectionBatch, processed);
            const [event] = await source.query(
                "SELECT projectionState FROM statistics_event WHERE eventKey = ?",
                [`view:${canaryViewId.toLowerCase()}`],
            );
            if (event?.projectionState === "done") {
                await refreshRankings();
                const page = await rankings.findRankings(`statistics-workload-canary-${Date.now()}`, {
                    ...rankRequest,
                    criteria: { ids: [seeded.firstGameId] },
                    limit: 100,
                });
                if (page.items[0]?.score > baselineScore) {
                    visibilityMs = Number((performance.now() - canaryStart).toFixed(2));
                    break;
                }
            }
            await delay(1000);
        }
        assert(visibilityMs > 0 && visibilityMs < 60_000, "projected view must reach a public ranking within 60 seconds");

        const overloadStart = performance.now();
        const overloadViews = Array.from({ length: 650 }, async (_, index) => {
            const viewId = randomUUID();
            await statistics.recordView(undefined, {
                sourceType: StatisticsSourceType.GAME,
                sourceId: seeded.firstGameId,
                viewId,
            });
            return viewId;
        });
        const overloadIds = await Promise.all(overloadViews);
        let overLimitRejected = false;
        try { await projection.drain(projectionBatchSize + 1); }
        catch { overLimitRejected = true; }
        assert(overLimitRejected, "projector must reject a batch above the configured bound");
        let remaining = overloadIds.length;
        while (remaining > 0) {
            await delay(5000);
            const processed = await projection.drain(projectionBatchSize);
            assert(processed <= projectionBatchSize, "projector admitted more than 200 events");
            maxProjectionBatch = Math.max(maxProjectionBatch, processed);
            const [unfinished] = await source.query(
                "SELECT COUNT(*) AS count FROM statistics_event WHERE eventKey IN (?) AND projectionState = 'pending'",
                [overloadIds.map((id) => `view:${id.toLowerCase()}`)],
            );
            remaining = Number(unfinished.count);
        }
        const recoveryMs = Number((performance.now() - overloadStart).toFixed(2));

        readersRunning = false;
        await Promise.all(readerTasks);
        const diagnostics = await projection.diagnostics();
        const cacheEntries: string[] = [];
        let cacheBytes = 0;
        if (!cache.iterator) throw new Error("Redis cache adapter does not expose cache iteration");
        for await (const [key, value] of cache.iterator(cache.namespace)) {
            cacheEntries.push(key);
            cacheBytes += Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value ?? null));
        }
        const [duePlan] = await explain(source,
            "SELECT id FROM statistics_event WHERE projectionState = 'pending' AND nextAttemptAt <= CURRENT_TIMESTAMP(6) ORDER BY nextAttemptAt, id LIMIT 200 FOR UPDATE SKIP LOCKED",
        );
        const [hourPlan] = await explain(source,
            "SELECT targetId, SUM(metricValue) FROM metric_hour WHERE metricCode IN ('views','like_credit') AND bucketStart >= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 7 DAY) AND bucketStart < CURRENT_TIMESTAMP(6) GROUP BY targetId",
        );
        const [rankPlan] = await explain(source,
            `SELECT g.id, s.score FROM game g JOIN statistics_target t ON t.id = g.statisticsTargetId\n             LEFT JOIN ranking_score s ON s.targetId = t.id AND s.rankingKey = 'game:popular:week'\n             WHERE t.sourceType = 'game' AND t.isActive = 1 ORDER BY s.score DESC, g.id ASC LIMIT 20`,
        );
        const result = {
            runId,
            fixture: { database: env.mysql.database, mysqlHost: env.mysql.host, redisHost: env.redis.host },
            seeded: { targets: targetCount, events: eventCount, targetSeedMs: seeded.targetSeedMs, seedEventsMs: seeded.seedEventsMs },
            workload: {
                durationSeconds: workloadSeconds,
                viewsPerSecond: viewRate,
                reactionsPerSecond: reactionRate,
                viewEvents: workloadSeconds * viewRate,
                reactions: workloadSeconds * reactionRate,
                outageSeconds: projectionPauseMs / 1000,
                outageRecoveryMs,
                latencyMs: {
                    writers: { p50: percentile(writerLatency, 50), p95: percentile(writerLatency, 95), p99: percentile(writerLatency, 99) },
                    rankings: { p50: percentile(readerLatency, 50), p95: percentile(readerLatency, 95), p99: percentile(readerLatency, 99) },
                    coldRanking: coldRankingMs,
                    warmRanking: warmRankingMs,
                    skewRanking: skewRankingMs,
                    filterBoundaryRanking: boundaryRankingMs,
                },
                readers: { concurrent: 8, requests: readersCount },
                visibilityMs,
                overload: {
                    injectedViews: overloadIds.length,
                    rejectedBatch201: overLimitRejected,
                    maxObservedBatch: maxProjectionBatch,
                    recoveryMs,
                },
            },
            resources: {
                peakProcessRssMb: Number((peakRss / (1024 * 1024)).toFixed(2)),
                redisCache: { entries: cacheEntries.length, approximateBytes: cacheBytes },
                workerBatchLimits: { configuredDrain: projectionBatchSize, maxObserved: maxProjectionBatch },
                diagnostics,
            },
            queryPlans: {
                projectionDueEvents: duePlan,
                temporalHourlyAggregation: hourPlan,
                commonPreparedRanking: rankPlan,
            },
        };
        console.log(JSON.stringify(result, null, 2));
    } finally {
        clearInterval(memorySampler);
        await cache.disconnect().catch(() => undefined);
        await source.destroy().catch(() => undefined);
    }
}

if (require.main === module) {
    runStatisticsWorkload().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
