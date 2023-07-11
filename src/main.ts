import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SupertokensExceptionFilter } from "./auth/auth.filter";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { NestExpressApplication } from "@nestjs/platform-express";

import { publicUploadDir } from "./utils/constants";
import * as process from "process";

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: "1",
    });
    app.enableCors({
        credentials: true,
        origin: true,
        optionsSuccessStatus: 204,
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

    SwaggerModule.setup("v1/docs", app, swaggerDocument);
    app.useGlobalFilters(new SupertokensExceptionFilter());
    app.useStaticAssets(publicUploadDir, {
        prefix: "/v1/public/uploads",
    });

    await app.listen(process.env.SERVER_PORT || 5000);
}

bootstrap();
