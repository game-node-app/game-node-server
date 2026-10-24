import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DataSource, DataSourceOptions } from "typeorm";
import { Queue } from "bullmq";
import { IgdbCatalogState } from "../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import { IgdbCatalogStateService } from "../src/sync/igdb/catalog/igdb-catalog-state.service";
import { IgdbCatalogSchedulerService } from "../src/sync/igdb/catalog/igdb-catalog-scheduler.service";
import { catalogConfig } from "../src/sync/igdb/catalog/igdb-catalog.config";
import { IGDB_CATALOG_QUEUE_NAME } from "../src/sync/igdb/catalog/igdb-catalog.constants";
import { testEnvironment } from "../test/igdb/helpers/test-environment";

@Module({})
class CatalogOperatorModule {}

export async function catalogCommand(
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
    const [command, ...flags] = args;
    if (
        !["status", "resume"].includes(command) ||
        flags.some((flag) => flag !== "--local")
    )
        throw new Error("Usage: igdb:catalog status|resume [--local]");
    const local = flags.includes("--local") ? testEnvironment(env) : null;
    if (!local && (!env.DB_HOST || !env.DB_USER || !env.DB_DATABASE))
        throw new Error(
            "Export DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_DATABASE, or use --local for the disposable harness; no .env is loaded",
        );
    const options: DataSourceOptions = {
        ...(local?.mysql ?? {
            type: "mysql",
            host: env.DB_HOST,
            port: Number(env.DB_PORT ?? 3306),
            username: env.DB_USER,
            password: env.DB_PASS,
            database: env.DB_DATABASE,
        }),
        timezone: "Z",
        bigNumberStrings: false,
        entities: [IgdbCatalogState],
        connectTimeout: 5000,
    };
    const source = await new DataSource(options).initialize();
    const app = await NestFactory.createApplicationContext(
        {
            module: CatalogOperatorModule,
            providers: [
                { provide: DataSource, useValue: source },
                IgdbCatalogStateService,
            ],
        },
        { logger: false },
    );
    const queues: Queue[] = [];
    try {
        const state = app.get(IgdbCatalogStateService);
        if (command === "resume") {
            const config = catalogConfig(env);
            if (!local && !env.BULLMQ_REDIS_URL)
                throw new Error("Export BULLMQ_REDIS_URL for resume");
            const url = local ? null : new URL(env.BULLMQ_REDIS_URL!);
            const connection = local?.redis ?? {
                host: url!.hostname,
                port: Number(url!.port || 6379),
                username: url!.username || undefined,
                password: url!.password || undefined,
            };
            const prefix = local?.prefix;
            const catalog = new Queue(IGDB_CATALOG_QUEUE_NAME, {
                connection,
                prefix,
            });
            queues.push(catalog);
            if ((await state.readStatus()).status === "paused") {
                await state.resumeRun();
            } else {
                throw new Error("Only a paused catalog run can be resumed");
            }
            await new IgdbCatalogSchedulerService(
                state,
                catalog,
                config,
            ).reconcile();
        }
        const current = await state.readStatus();
        return {
            runId: current.runId,
            status: current.status,
            committedId: current.committedId,
            upperId: current.upperId,
            committedGames: current.committedGames,
            committedBatches: current.committedBatches,
            startedAt: current.startedAt,
            completedAt: current.completedAt,
            nextEligibleAt: current.nextEligibleAt,
            retryStage: current.retryStage,
            retryGameId: current.retryGameId,
            attempt: current.attempt,
            failureSummary: current.failureSummary,
            ownerGeneration: current.ownerGeneration,
            leaseExpiresAt: current.leaseExpiresAt,
        };
    } finally {
        await Promise.all(queues.map((queue) => queue.close()));
        await app.close();
        await source.destroy();
    }
}

if (require.main === module)
    catalogCommand(process.argv.slice(2))
        .then((result) =>
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
        )
        .catch(() => {
            process.stderr.write(
                "IGDB catalog command failed. Check command syntax, local services, exported database settings and the state migration.\n",
            );
            process.exitCode = 1;
        });
