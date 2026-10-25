import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
    getDataSourceToken,
    getRepositoryToken,
    TypeOrmModule,
} from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { GameGenre } from "../game/game-repository/entities/game-genre.entity";
import { GamePlatform } from "../game/game-repository/entities/game-platform.entity";
import { GameTheme } from "../game/game-repository/entities/game-theme.entity";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import {
    SEARCH_DEFAULT_MANTICORE_URL,
    SEARCH_ENGINE_TIMEOUT_MS,
} from "./search.constants";

const SEARCH_RESOURCE_ENTITIES = [GameGenre, GameTheme, GamePlatform] as const;

// Register search resource entities with TypeORM metadata storage for autoLoadEntities
TypeOrmModule.forFeature([...SEARCH_RESOURCE_ENTITIES]);

@Module({
    imports: [
        HttpModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                baseURL:
                    configService.get<string>("MANTICORE_URL") ||
                    SEARCH_DEFAULT_MANTICORE_URL,
                timeout: SEARCH_ENGINE_TIMEOUT_MS,
            }),
        }),
    ],
    controllers: [SearchController],
    providers: [
        ...SEARCH_RESOURCE_ENTITIES.map((entity) => ({
            provide: getRepositoryToken(entity),
            inject: [{ token: getDataSourceToken(), optional: true }],
            useFactory: (dataSource?: DataSource) =>
                dataSource ? dataSource.getRepository(entity) : undefined,
        })),
        SearchService,
    ],
    exports: [SearchService],
})
export class SearchModule {}
