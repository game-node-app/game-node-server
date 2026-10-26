import "reflect-metadata";
import { DataSource } from "typeorm";
import { Queue } from "bullmq";
import { resolve } from "node:path";
import { NotificationsCutoverService } from "../src/notifications/notifications-cutover.service";
import { testEnvironment } from "../test/igdb/helpers/test-environment";
import { getRedisConfig } from "../src/utils/getRedisConfig";
import { CreateNotificationCutoverLedger1792960197566 } from "../src/migrations/1792960197566-CreateNotificationCutoverLedger";

export async function notificationCutoverCommand(args: string[]) {
    const [command, ...flags] = args;
    const local = flags.includes("--local");
    const backupFlag = flags.find((flag) =>
        flag.startsWith("--backup-reference="),
    );
    if (
        !["status", "inventory", "convert", "verify"].includes(command) ||
        flags.some(
            (flag) =>
                flag !== "--local" && !flag.startsWith("--backup-reference="),
        ) ||
        (command === "verify" && !backupFlag)
    ) {
        throw new Error(
            "Usage: notifications:cutover status|inventory|convert|verify [--local] [--backup-reference=<coordinated-backup>]",
        );
    }
    const fixture = local ? testEnvironment(process.env) : null;
    const source = fixture
        ? new DataSource({
              ...fixture.mysql,
              entities: [resolve(__dirname, "../src/**/*.entity.ts")],
              timezone: "Z",
          })
        : (require("../data-source").AppDataSource as DataSource);
    await source.initialize();
    try {
        const runner = source.createQueryRunner();
        try {
            if (command === "status" && !await runner.hasTable("notification_cutover_state")) return { prepared: false };
            if (command !== "status") await new CreateNotificationCutoverLedger1792960197566().up(runner);
        } finally { await runner.release(); }
        const cutover = new NotificationsCutoverService(source);
        if (command === "convert") {
            let converted = 0,
                excluded = 0,
                result;
            do {
                result = await cutover.convertLegacyNotifications();
                converted += result.convertedCount;
                excluded += result.excludedCount;
            } while (result.hasMore);
            let transferred = 0,
                count;
            do {
                count = await cutover.transferPendingImporterResults();
                transferred += count;
            } while (count === 100);
            return { converted, excluded, transferred };
        }
        if (command === "inventory") {
            const connection = fixture?.redis || getRedisConfig("bullmq");
            let captured = 0;
            for (const name of ["notifications-queue", "statistics-queue"]) {
                const queue = new Queue(name, {
                    connection: {
                        host: connection.host,
                        port: connection.port,
                    },
                    ...(fixture
                        ? { prefix: "igdb-test-notifications-cutover" }
                        : {}),
                });
                try {
                    if (await queue.getWorkersCount())
                        throw new Error(
                            "Stop old queue workers before taking the inventory",
                        );
                    await queue.pause();
                    let result;
                    do {
                        result = await cutover.captureLegacyQueue(queue);
                        captured += result.captured;
                    } while (result.hasMore);
                } finally {
                    await queue.close();
                }
            }
            return { captured };
        }
        if (command === "verify")
            return await cutover.verify(
                backupFlag!.slice("--backup-reference=".length),
            );
        return await source.query(
            "SELECT id, lastId, convertedCount, excludedCount, completed FROM notification_cutover_state ORDER BY id",
        );
    } finally {
        await source.destroy();
    }
}

if (require.main === module)
    notificationCutoverCommand(process.argv.slice(2))
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(
                error instanceof Error ? error.message : "Cutover failed",
            );
            process.exitCode = 1;
        });
