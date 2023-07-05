import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SupertokensExceptionFilter } from "./auth/auth.filter";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: "1",
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    const swaggerConfig = new DocumentBuilder()
        .setTitle("GameNode API")
        .setDescription(
            "API docs for the videogame catalog system GameNode. <br><br>Built with love by the GameNode team.",
        )
        .setVersion("1.0")
        .build();

    const swaggerDocument = await SwaggerModule.createDocument(
        app,
        swaggerConfig,
    );

    SwaggerModule.setup("v1/docs", app, swaggerDocument);
    app.useGlobalFilters(new SupertokensExceptionFilter());
    await app.listen(5000);
}

bootstrap();
