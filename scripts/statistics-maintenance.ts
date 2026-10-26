import "reflect-metadata";
import { DataSource } from "typeorm";
import { Queue } from "bullmq";
import { resolve } from "node:path";
import { testEnvironment } from "../test/igdb/helpers/test-environment";
import { StatisticsMaintenanceService } from "../src/statistics/statistics-maintenance.service";
import { StatisticsRankingService } from "../src/statistics/statistics-ranking.service";
import { StatisticsProjectionService } from "../src/statistics/statistics-projection.service";
import { getRedisConfig } from "../src/utils/getRedisConfig";

const batchStates = ["wait", "paused", "delayed", "active", "failed", "completed", "waiting-children", "prioritized"];

function parseFlags(flags: string[]) {
    const backupReference = flags.find((flag) => flag.startsWith("--backup-reference="))?.slice("--backup-reference=".length);
    const batchText = flags.find((flag) => flag.startsWith("--batch-size="))?.slice("--batch-size=".length);
    const eventIdText = flags.find((flag) => flag.startsWith("--event-id="))?.slice("--event-id=".length);
    const allowed = new Set(["--local", "--resume"]);
    if (flags.some((flag) => !allowed.has(flag) && !flag.startsWith("--backup-reference=") && !flag.startsWith("--batch-size=") && !flag.startsWith("--event-id=")))
        throw new Error("Unknown statistics maintenance option");
    const batchSize = batchText === undefined ? 100 : Number(batchText);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
        throw new Error("--batch-size must be an integer from 1 to 500");
    const eventId = eventIdText === undefined ? undefined : Number(eventIdText);
    if (eventId !== undefined && (!Number.isSafeInteger(eventId) || eventId < 1))
        throw new Error("--event-id must be a positive safe integer");
    return { backupReference, batchSize, eventId, local: flags.includes("--local"), resume: flags.includes("--resume") };
}

function cursorOf(status: any) {
    if (!status?.cursor) return { phase: "sources", sourceIndex: 0, lastId: "" };
    return typeof status.cursor === "string" ? JSON.parse(status.cursor) : status.cursor;
}

export async function statisticsMaintenanceCommand(args: string[]) {
    const [command, ...flags] = args;
    if (!["status", "diagnostics", "rearm", "convert", "rebuild"].includes(command))
        throw new Error("Usage: statistics:maintenance status|diagnostics|rearm|convert|rebuild [--local] [--resume] [--batch-size=100] [--backup-reference=<coordinated-backup>] [--event-id=<numeric-event-id>]");
    const options = parseFlags(flags);
    if (["convert", "rebuild"].includes(command) && !options.backupReference)
        throw new Error("A coordinated backup reference is required for conversion and rebuild");
    const fixture = options.local ? testEnvironment(process.env) : null;
    const source = fixture
        ? new DataSource({
              ...fixture.mysql,
              entities: [resolve(__dirname, "../src/**/*.entity.ts")],
              timezone: "Z",
          })
        : (require("../data-source").AppDataSource as DataSource);
    await source.initialize();
    let queue: Queue | undefined;
    try {
        const maintenance = new StatisticsMaintenanceService(source, new StatisticsRankingService(source));
        if (command === "status") return await maintenance.status();
        if (command === "diagnostics") return { maintenance: await maintenance.status(), ...await new StatisticsProjectionService(source).diagnostics() };
        if (command === "rearm") {
            if (options.eventId === undefined) throw new Error("A failed numeric event ID is required for rearm");
            return { eventId: options.eventId, rearmed: await new StatisticsProjectionService(source).rearm(options.eventId) };
        }
        if (command === "rebuild")
            return await maintenance.rebuild(options.backupReference!, options.resume, options.batchSize);

        let cursor = cursorOf(await maintenance.status());
        if (cursor.phase === "complete") return await maintenance.status();

        const redis = fixture?.redis ?? getRedisConfig("bullmq");
        queue = new Queue("statistics-queue", {
            connection: { host: redis.host, port: redis.port },
            ...(fixture ? { prefix: "igdb-test-notifications-cutover" } : {}),
        });
        if (await queue.getWorkersCount())
            throw new Error("Stop old statistics queue workers and application ingress before conversion");
        if (!(await queue.isPaused())) await queue.pause();
        let resume = options.resume;
        while (cursor.phase !== "queue" && cursor.phase !== "ready" && cursor.phase !== "complete") {
            const result = await maintenance.convertLegacyBatch(options.backupReference!, resume, options.batchSize);
            resume = true;
            cursor = result.cursor;
        }
        while (cursor.phase === "queue") {
            const state = cursor.state;
            if (!batchStates.includes(state)) throw new Error("Invalid statistics queue checkpoint state");
            const offset = cursor.offset;
            const jobs = await queue.getJobs([state as any], offset, offset + options.batchSize - 1, true);
            await maintenance.captureLegacyQueueBatch(
                state,
                offset,
                jobs.map((job) => ({
                    id: String(job.id ?? ""),
                    name: job.name,
                    data: job.data as Record<string, unknown>,
                    timestamp: job.timestamp,
                })),
                jobs.length === options.batchSize,
                options.batchSize,
            );
            cursor = cursorOf(await maintenance.status());
        }
        if (cursor.phase !== "ready" && cursor.phase !== "complete")
            throw new Error("Statistics conversion stopped before queue inventory completed");
        if (cursor.phase === "ready") await maintenance.finishConversion(options.backupReference!);
        return await maintenance.status();
    } finally {
        await queue?.close();
        await source.destroy();
    }
}

if (require.main === module)
    statisticsMaintenanceCommand(process.argv.slice(2))
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error instanceof Error ? error.message : "Statistics maintenance failed");
            process.exitCode = 1;
        });
