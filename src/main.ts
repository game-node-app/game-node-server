// Must stay the first import so instrumentations can patch modules before they load.
import "./tracing";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Cache } from "@nestjs/cache-manager";
import { NestExpressApplication } from "@nestjs/platform-express";
import duration from "dayjs/plugin/duration";
import dayjs from "dayjs";
import { publicImagesDir } from "./utils/constants";
import { json, urlencoded } from "express";
import { AuthService } from "./auth/auth.service";
import { mountAuth } from "./auth/mount-auth";
import * as fs from "fs";
import { SQLExceptionFilter } from "./filter/sql-exception.filter";
import { AxiosExceptionFilter } from "./filter/axios-exception.filter";
import {
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { Logger } from "nestjs-pino";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { setCacheManager } from "./utils/cacheable";
import { CORS_OPTIONS } from "./auth/cors-options";
import cluster from "node:cluster";
import { RUNS_BACKGROUND_WORK } from "./utils/app-role";
import { limitConcurrencyPerClient } from "./utils/client-concurrency";

dayjs.extend(duration);

async function bootstrap() {
    initializeTransactionalContext({
        storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
    });

    // Better Auth reads the raw body, so Nest's parsers are replaced below, after the auth handler.
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bodyParser: false,
    });
    app.enableShutdownHooks();

    app.useLogger(app.get(Logger));

    /**
     * Trust IP Address received from proxy
     */
    if (process.env.NODE_ENV !== "development") {
        app.set("trust proxy", "loopback");
    }

    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: "1",
    });

    app.useGlobalFilters(new SQLExceptionFilter(), new AxiosExceptionFilter());

    app.enableCors(CORS_OPTIONS);

    app.use(limitConcurrencyPerClient());

    mountAuth(app.getHttpAdapter().getInstance(), app.get(AuthService));

    // No JSON body needs more; a larger one costs real CPU to parse and validate before any check can reject it.
    app.use(json({ limit: "1mb" }));
    app.use(urlencoded({ extended: true }));

    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        }),
    );

    const cacheManager: Cache = app.get(CACHE_MANAGER);

    setCacheManager(cacheManager);

    const swaggerConfig = new DocumentBuilder()
        .setTitle("GameNode API")
        .setDescription(
            "API docs for the videogame catalog system GameNode. <br><br>Built with love by the GameNode team.",
        )
        .setVersion("1.0")
        .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    const swaggerFileName = "server_swagger.json";
    fs.writeFileSync(swaggerFileName, JSON.stringify(swaggerDocument));
    console.log(
        `Generated JSON of Swagger Documentation: ${swaggerFileName} at the project's root dir.`,
    );

    SwaggerModule.setup("v1/docs", app, swaggerDocument);

    app.useStaticAssets(publicImagesDir, {
        prefix: "/v1/public",
    });

    await app.listen(process.env.SERVER_PORT || 5000);
}

/** Forks API processes that share the port, so one blocked event loop doesn't stall every request. */
function runApiProcesses(count: number) {
    if (RUNS_BACKGROUND_WORK) {
        throw new Error(
            "API_PROCESSES > 1 requires APP_ROLE=api; crons and boot jobs would run once per process",
        );
    }
    let stopping = false;
    for (let i = 0; i < count; i++) cluster.fork();
    cluster.on("exit", (worker, code, signal) => {
        if (stopping) {
            if (Object.keys(cluster.workers ?? {}).length === 0)
                process.exit(0);
            return;
        }
        console.error(
            `API process ${worker.process.pid} exited (${signal ?? code}), restarting`,
        );
        // The delay keeps a process that fails at boot from spinning.
        setTimeout(() => cluster.fork(), 1000);
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
        process.on(signal, () => {
            stopping = true;
            for (const worker of Object.values(cluster.workers ?? {})) {
                worker?.process.kill(signal);
            }
        });
    }
}

const apiProcesses = Number(process.env.API_PROCESSES || 1);
if (cluster.isPrimary && apiProcesses > 1) {
    runApiProcesses(apiProcesses);
} else {
    bootstrap();
}
