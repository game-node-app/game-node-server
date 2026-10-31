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
import { toNodeHandler } from "better-auth/node";
import { AuthService } from "./auth/auth.service";
import * as fs from "fs";
import * as process from "process";
import { SQLExceptionFilter } from "./filter/sql-exception.filter";
import { AxiosExceptionFilter } from "./filter/axios-exception.filter";
import {
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { Logger } from "nestjs-pino";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { setCacheManager } from "./utils/cacheable";

dayjs.extend(duration);

async function bootstrap() {
    // await tracer.start();
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

    app.enableCors({
        credentials: true,
        origin: true,
        optionsSuccessStatus: 204,
        allowedHeaders: ["content-type", "authorization"],
        exposedHeaders: ["set-auth-token"],
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    });

    // Not app.use("/v1/auth"): Express strips mount prefixes, and Better Auth routes by full path.
    app.getHttpAdapter()
        .getInstance()
        .all("/v1/auth/*splat", toNodeHandler(app.get(AuthService).auth));

    app.use(json({ limit: "15mb" }));
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

bootstrap();
