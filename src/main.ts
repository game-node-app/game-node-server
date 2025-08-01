import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SupertokensExceptionFilter } from "./auth/auth.filter";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { NestExpressApplication } from "@nestjs/platform-express";
import duration from "dayjs/plugin/duration";
import dayjs from "dayjs";
import supertokens from "supertokens-node";

import { publicImagesDir } from "./utils/constants";
import { json } from "express";
import * as fs from "fs";
import * as process from "process";
import { SQLExceptionFilter } from "./filter/sql-exception.filter";
import { AxiosExceptionFilter } from "./filter/axios-exception.filter";
import {
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";

dayjs.extend(duration);

async function bootstrap() {
    initializeTransactionalContext({
        storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
    });

    const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
        allowedHeaders: ["content-type", ...supertokens.getAllCORSHeaders()],
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    });

    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        }),
    );

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

    app.useGlobalFilters(new SupertokensExceptionFilter());

    app.useStaticAssets(publicImagesDir, {
        prefix: "/v1/public",
    });

    app.use(json({ limit: "15mb" }));

    await app.listen(process.env.SERVER_PORT || 5000);
}

bootstrap();
