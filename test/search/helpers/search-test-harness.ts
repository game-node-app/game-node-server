import "reflect-metadata";
import { execFileSync, spawn } from "child_process";
import * as path from "path";
import axios from "axios";
import {
    Global,
    INestApplication,
    MiddlewareConsumer,
    Module,
    NestModule,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { getDataSourceToken } from "@nestjs/typeorm";
import { Test } from "@nestjs/testing";
import { json } from "express";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import {
    DataSource,
    EntitySchema,
    EntitySchemaColumnOptions,
    EntitySchemaRelationOptions,
    getMetadataArgsStorage,
} from "typeorm";
import { AuthMiddleware } from "../../../src/auth/auth.middleware";
import { SupertokensExceptionFilter } from "../../../src/auth/auth.filter";
import { AxiosExceptionFilter } from "../../../src/filter/axios-exception.filter";
import { SQLExceptionFilter } from "../../../src/filter/sql-exception.filter";
import { Game } from "../../../src/game/game-repository/entities/game.entity";
import { GameAlternativeName } from "../../../src/game/game-repository/entities/game-alternative-name.entity";
import { GameCover } from "../../../src/game/game-repository/entities/game-cover.entity";
import { GameGenre } from "../../../src/game/game-repository/entities/game-genre.entity";
import { GameKeyword } from "../../../src/game/game-repository/entities/game-keyword.entity";
import { GamePlatform } from "../../../src/game/game-repository/entities/game-platform.entity";
import { GameTheme } from "../../../src/game/game-repository/entities/game-theme.entity";
import { Profile } from "../../../src/profile/entities/profile.entity";
import { SearchModule } from "../../../src/search/search.module";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const SEARCH_TEST_COMPOSE_FILE = path.join(
    REPO_ROOT,
    "test/search/docker-compose.yml",
);
export const SEARCH_TEST_PROJECT = "search-api-test";

export function getSearchTestEnv() {
    const mysqlPort = Number(process.env.SEARCH_TEST_MYSQL_PORT || 23306);
    const manticoreHttpPort = Number(
        process.env.SEARCH_TEST_MANTICORE_HTTP_PORT || 29308,
    );
    const manticoreSqlPort = Number(
        process.env.SEARCH_TEST_MANTICORE_SQL_PORT || 29306,
    );
    return {
        mysql: {
            host: "127.0.0.1",
            port: mysqlPort,
            rootUser: "root",
            rootPassword: "search-test-root",
            username: "search_test",
            password: "search-test-password",
            database: "search_api_test",
        },
        manticore: {
            httpPort: manticoreHttpPort,
            sqlPort: manticoreSqlPort,
            url: `http://127.0.0.1:${manticoreHttpPort}`,
        },
    };
}

let supertokensInitialized = false;

function ensureSupertokensInitialized() {
    if (supertokensInitialized) {
        return;
    }
    supertokens.init({
        appInfo: {
            appName: "GameNode",
            apiDomain: "http://localhost:5000",
            websiteDomain: "http://localhost:3000",
            apiBasePath: "/v1/auth",
            websiteBasePath: "/auth",
        },
        supertokens: {
            connectionURI: "http://localhost:3567",
        },
        recipeList: [Session.init()],
    });
    supertokensInitialized = true;
}

export async function createSearchTestApp(
    dataSource: DataSource,
): Promise<INestApplication> {
    ensureSupertokensInitialized();
    const { manticore } = getSearchTestEnv();

    @Global()
    @Module({
        imports: [
            ConfigModule.forRoot({
                isGlobal: true,
                ignoreEnvFile: true,
                load: [
                    () => ({
                        MANTICORE_URL: manticore.url,
                    }),
                ],
            }),
            SearchModule,
        ],
        providers: [
            {
                provide: getDataSourceToken(),
                useValue: dataSource,
            },
        ],
        exports: [getDataSourceToken()],
    })
    class SearchIntegrationAppModule implements NestModule {
        configure(consumer: MiddlewareConsumer) {
            consumer.apply(AuthMiddleware).forRoutes("*");
        }
    }

    const moduleRef = await Test.createTestingModule({
        imports: [SearchIntegrationAppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: "1",
    });
    app.enableCors({
        origin: true,
        credentials: true,
    });
    app.use(json({ limit: "15mb" }));
    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        }),
    );
    app.useGlobalFilters(new SupertokensExceptionFilter());
    app.useGlobalFilters(new SQLExceptionFilter());
    app.useGlobalFilters(new AxiosExceptionFilter());

    await app.init();
    return app;
}

type EntityConstructor = new (...args: any[]) => any;

export function buildSearchEntitySchemas(): EntitySchema[] {
    const targets = new Set<EntityConstructor>([
        Game,
        GameGenre,
        GameTheme,
        GamePlatform,
        GameKeyword,
        GameCover,
        GameAlternativeName,
        Profile,
    ]);
    const storage = getMetadataArgsStorage();
    return [...targets].map((target) => {
        const ancestors: EntityConstructor[] = [];
        for (
            let current: any = target;
            current && current !== Function.prototype;
            current = Object.getPrototypeOf(current)
        ) {
            ancestors.push(current);
        }
        const columns: Record<string, EntitySchemaColumnOptions> = {};
        for (const column of storage.columns.filter((item) =>
            ancestors.includes(item.target as EntityConstructor),
        )) {
            const generation = storage.generations.find(
                (item) =>
                    item.target === column.target &&
                    item.propertyName === column.propertyName,
            );
            columns[column.propertyName] = {
                ...column.options,
                type:
                    column.options.type ??
                    Reflect.getMetadata(
                        "design:type",
                        (column.target as EntityConstructor).prototype,
                        column.propertyName,
                    ),
                createDate: column.mode === "createDate",
                updateDate: column.mode === "updateDate",
                ...(generation ? { generated: generation.strategy } : {}),
            } as EntitySchemaColumnOptions;
        }
        const relations: Record<string, EntitySchemaRelationOptions> = {};
        for (const relation of storage.relations.filter((item) =>
            ancestors.includes(item.target as EntityConstructor),
        )) {
            const referenced =
                typeof relation.type === "function"
                    ? (relation.type as () => EntityConstructor)()
                    : null;
            if (!referenced || !targets.has(referenced)) {
                continue;
            }
            const joinColumn = storage.joinColumns.find(
                (item) =>
                    item.target === relation.target &&
                    item.propertyName === relation.propertyName,
            );
            const joinTable = storage.joinTables.find(
                (item) =>
                    item.target === relation.target &&
                    item.propertyName === relation.propertyName,
            );
            relations[relation.propertyName] = {
                ...relation.options,
                type: relation.relationType,
                target: () => referenced,
                inverseSide:
                    typeof relation.inverseSideProperty === "function"
                        ? relation.inverseSideProperty(
                              new Proxy(
                                  {},
                                  { get: (_object, key) => String(key) },
                              ),
                          )
                        : relation.inverseSideProperty,
                ...(joinColumn
                    ? {
                          joinColumn: {
                              name: joinColumn.name,
                              referencedColumnName:
                                  joinColumn.referencedColumnName,
                          },
                      }
                    : {}),
                ...(joinTable ? { joinTable: true } : {}),
            };
        }
        return new EntitySchema({
            name: target.name,
            target: target as any,
            columns,
            relations,
        });
    });
}

const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS \`game\` (
        \`id\` bigint NOT NULL,
        \`name\` varchar(255) NOT NULL,
        \`slug\` varchar(255) NOT NULL,
        \`aggregatedRating\` double NULL,
        \`aggregatedRatingCount\` int NULL,
        \`category\` int NOT NULL DEFAULT 0,
        \`status\` int NOT NULL DEFAULT 0,
        \`summary\` text NULL,
        \`storyline\` text NULL,
        \`checksum\` varchar(255) NULL,
        \`url\` varchar(255) NULL,
        \`firstReleaseDate\` datetime NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`statisticsTargetId\` bigint unsigned NULL,
        UNIQUE INDEX \`UQ_game_statistics_target\` (\`statisticsTargetId\`),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_cover\` (
        \`id\` bigint NOT NULL,
        \`alphaChannel\` tinyint NULL,
        \`animated\` tinyint NULL,
        \`height\` int NULL,
        \`imageId\` varchar(255) NULL,
        \`url\` varchar(255) NULL,
        \`width\` int NULL,
        \`checksum\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`gameId\` bigint NULL,
        UNIQUE INDEX \`REL_game_cover_gameId\` (\`gameId\`),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_alternative_name\` (
        \`id\` bigint NOT NULL,
        \`comment\` varchar(255) NULL,
        \`name\` text NULL,
        \`checksum\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`gameId\` bigint NULL,
        INDEX \`IDX_gan_gameId\` (\`gameId\`),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_genre\` (
        \`id\` bigint NOT NULL,
        \`checksum\` varchar(255) NULL,
        \`name\` varchar(255) NULL,
        \`slug\` varchar(255) NULL,
        \`url\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_genres_game_genre\` (
        \`gameId\` bigint NOT NULL,
        \`gameGenreId\` bigint NOT NULL,
        INDEX \`IDX_gggg_gameId\` (\`gameId\`),
        INDEX \`IDX_gggg_gameGenreId\` (\`gameGenreId\`),
        PRIMARY KEY (\`gameId\`, \`gameGenreId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_theme\` (
        \`id\` bigint NOT NULL,
        \`checksum\` varchar(255) NULL,
        \`name\` varchar(255) NULL,
        \`slug\` varchar(255) NULL,
        \`url\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_themes_game_theme\` (
        \`gameId\` bigint NOT NULL,
        \`gameThemeId\` bigint NOT NULL,
        INDEX \`IDX_gtgt_gameId\` (\`gameId\`),
        INDEX \`IDX_gtgt_gameThemeId\` (\`gameThemeId\`),
        PRIMARY KEY (\`gameId\`, \`gameThemeId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_platform\` (
        \`id\` bigint NOT NULL,
        \`abbreviation\` varchar(255) NULL,
        \`alternative_name\` varchar(255) NULL,
        \`category\` int NOT NULL DEFAULT 1,
        \`checksum\` varchar(255) NULL,
        \`generation\` int NULL,
        \`name\` varchar(255) NOT NULL,
        \`slug\` varchar(255) NULL,
        \`url\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_platform_games_game\` (
        \`gamePlatformId\` bigint NOT NULL,
        \`gameId\` bigint NOT NULL,
        INDEX \`IDX_gpgg_gamePlatformId\` (\`gamePlatformId\`),
        INDEX \`IDX_gpgg_gameId\` (\`gameId\`),
        PRIMARY KEY (\`gamePlatformId\`, \`gameId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_keyword\` (
        \`id\` bigint NOT NULL,
        \`checksum\` varchar(255) NULL,
        \`name\` varchar(255) NULL,
        \`slug\` varchar(255) NULL,
        \`url\` varchar(255) NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`game_keywords_game_keyword\` (
        \`gameId\` bigint NOT NULL,
        \`gameKeywordId\` bigint NOT NULL,
        INDEX \`IDX_gkgk_gameId\` (\`gameId\`),
        INDEX \`IDX_gkgk_gameKeywordId\` (\`gameKeywordId\`),
        PRIMARY KEY (\`gameId\`, \`gameKeywordId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`statistics_target\` (
        \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
        \`sourceType\` varchar(32) NOT NULL,
        \`isActive\` tinyint NOT NULL DEFAULT 1,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`metric_total\` (
        \`targetId\` bigint unsigned NOT NULL,
        \`metricCode\` varchar(32) NOT NULL,
        \`metricValue\` bigint unsigned NOT NULL DEFAULT 0,
        PRIMARY KEY (\`targetId\`, \`metricCode\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`profile\` (
        \`userId\` varchar(36) NOT NULL,
        \`username\` varchar(20) NOT NULL,
        \`bio\` varchar(240) NULL,
        \`usernameLastUpdatedAt\` timestamp NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`avatarId\` int NULL,
        \`bannerId\` int NULL,
        UNIQUE INDEX \`IDX_profile_username\` (\`username\`),
        PRIMARY KEY (\`userId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const ALL_TABLES = [
    "game_genres_game_genre",
    "game_themes_game_theme",
    "game_platform_games_game",
    "game_keywords_game_keyword",
    "game_cover",
    "game_alternative_name",
    "metric_total",
    "statistics_target",
    "game_genre",
    "game_theme",
    "game_platform",
    "game_keyword",
    "game",
    "profile",
];

export async function createSearchTestDataSource(): Promise<DataSource> {
    const env = getSearchTestEnv();
    const dataSource = new DataSource({
        type: "mysql",
        host: env.mysql.host,
        port: env.mysql.port,
        username: env.mysql.username,
        password: env.mysql.password,
        database: env.mysql.database,
        timezone: "Z",
        bigNumberStrings: false,
        entities: buildSearchEntitySchemas(),
        synchronize: false,
    });
    await dataSource.initialize();
    for (const stmt of SCHEMA_STATEMENTS) {
        await dataSource.query(stmt);
    }
    return dataSource;
}

export async function resetSearchTestTables(
    dataSource: DataSource,
): Promise<void> {
    await dataSource.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
        for (const table of ALL_TABLES) {
            await dataSource.query(`TRUNCATE TABLE \`${table}\``);
        }
    } finally {
        await dataSource.query("SET FOREIGN_KEY_CHECKS = 1");
    }
}

export interface SeedGameFixture {
    id: number;
    name: string;
    slug: string;
    category?: number;
    status?: number;
    url?: string | null;
    firstReleaseDate?: string | null;
    createdAt?: string;
    updatedAt?: string;
    coverUrl?: string | null;
    alternativeNames?: string[];
    genreIds?: number[];
    themeIds?: number[];
    platformIds?: number[];
    keywordIds?: number[];
    viewsCount?: number;
    likesCount?: number;
    includeStatisticsRow?: boolean;
}

export interface SeedResourcesFixture {
    genres?: Array<{ id: number; name: string; slug?: string }>;
    themes?: Array<{ id: number; name: string; slug?: string }>;
    platforms?: Array<{
        id: number;
        name: string;
        abbreviation?: string | null;
        slug?: string;
    }>;
    keywords?: Array<{ id: number; name: string; slug?: string }>;
    games?: SeedGameFixture[];
    profiles?: Array<{
        userId: string;
        username: string;
        bio?: string | null;
        createdAt?: string;
        updatedAt?: string;
    }>;
}

export async function seedSearchFixtures(
    dataSource: DataSource,
    fixture: SeedResourcesFixture,
): Promise<void> {
    let altIdCounter = 1;
    let coverIdCounter = 1;

    for (const genre of fixture.genres ?? []) {
        await dataSource.query(
            `INSERT INTO \`game_genre\` (\`id\`, \`name\`, \`slug\`) VALUES (?, ?, ?)`,
            [
                genre.id,
                genre.name,
                genre.slug ??
                    genre.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            ],
        );
    }

    for (const theme of fixture.themes ?? []) {
        await dataSource.query(
            `INSERT INTO \`game_theme\` (\`id\`, \`name\`, \`slug\`) VALUES (?, ?, ?)`,
            [
                theme.id,
                theme.name,
                theme.slug ??
                    theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            ],
        );
    }

    for (const platform of fixture.platforms ?? []) {
        await dataSource.query(
            `INSERT INTO \`game_platform\` (\`id\`, \`name\`, \`abbreviation\`, \`slug\`) VALUES (?, ?, ?, ?)`,
            [
                platform.id,
                platform.name,
                platform.abbreviation ?? null,
                platform.slug ??
                    platform.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            ],
        );
    }

    for (const keyword of fixture.keywords ?? []) {
        await dataSource.query(
            `INSERT INTO \`game_keyword\` (\`id\`, \`name\`, \`slug\`) VALUES (?, ?, ?)`,
            [
                keyword.id,
                keyword.name,
                keyword.slug ??
                    keyword.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            ],
        );
    }

    for (const game of fixture.games ?? []) {
        let targetId: number | null = null;
        if (
            game.includeStatisticsRow ??
            (game.viewsCount !== undefined || game.likesCount !== undefined)
        ) {
            const result = await dataSource.query(
                "INSERT INTO statistics_target (sourceType, isActive) VALUES ('game', 1)",
            );
            targetId = Number(result.insertId);
            await dataSource.query(
                "INSERT INTO metric_total (targetId, metricCode, metricValue) VALUES (?, 'views', ?), (?, 'likes_current', ?)",
                [targetId, game.viewsCount ?? 0, targetId, game.likesCount ?? 0],
            );
        }

        await dataSource.query(
            `INSERT INTO \`game\` (\`id\`, \`name\`, \`slug\`, \`category\`, \`status\`, \`url\`, \`firstReleaseDate\`, \`createdAt\`, \`updatedAt\`, \`statisticsTargetId\`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                game.id,
                game.name,
                game.slug,
                game.category ?? 0,
                game.status ?? 0,
                game.url ?? `https://www.igdb.com/games/${game.slug}`,
                game.firstReleaseDate ?? null,
                game.createdAt ?? "2024-01-01 00:00:00",
                game.updatedAt ?? "2024-01-02 00:00:00",
                targetId,
            ],
        );

        if (game.coverUrl) {
            await dataSource.query(
                `INSERT INTO \`game_cover\` (\`id\`, \`url\`, \`gameId\`) VALUES (?, ?, ?)`,
                [coverIdCounter++, game.coverUrl, game.id],
            );
        }

        for (const altName of game.alternativeNames ?? []) {
            await dataSource.query(
                `INSERT INTO \`game_alternative_name\` (\`id\`, \`name\`, \`gameId\`) VALUES (?, ?, ?)`,
                [altIdCounter++, altName, game.id],
            );
        }

        for (const genreId of game.genreIds ?? []) {
            await dataSource.query(
                `INSERT INTO \`game_genres_game_genre\` (\`gameId\`, \`gameGenreId\`) VALUES (?, ?)`,
                [game.id, genreId],
            );
        }

        for (const themeId of game.themeIds ?? []) {
            await dataSource.query(
                `INSERT INTO \`game_themes_game_theme\` (\`gameId\`, \`gameThemeId\`) VALUES (?, ?)`,
                [game.id, themeId],
            );
        }

        for (const platformId of game.platformIds ?? []) {
            await dataSource.query(
                `INSERT INTO \`game_platform_games_game\` (\`gamePlatformId\`, \`gameId\`) VALUES (?, ?)`,
                [platformId, game.id],
            );
        }

        for (const keywordId of game.keywordIds ?? []) {
            await dataSource.query(
                `INSERT INTO \`game_keywords_game_keyword\` (\`gameId\`, \`gameKeywordId\`) VALUES (?, ?)`,
                [game.id, keywordId],
            );
        }

    }

    for (const profile of fixture.profiles ?? []) {
        await dataSource.query(
            `INSERT INTO \`profile\` (\`userId\`, \`username\`, \`bio\`, \`createdAt\`, \`updatedAt\`) VALUES (?, ?, ?, ?, ?)`,
            [
                profile.userId,
                profile.username,
                profile.bio ?? null,
                profile.createdAt ?? "2024-01-01 00:00:00",
                profile.updatedAt ?? "2024-01-01 00:00:00",
            ],
        );
    }
}

export function execInSearchManticore(
    args: string[],
    options: { user?: string } = {},
): string {
    const cmdArgs = [
        "compose",
        "-p",
        SEARCH_TEST_PROJECT,
        "-f",
        SEARCH_TEST_COMPOSE_FILE,
        "exec",
        "-T",
    ];
    if (options.user) {
        cmdArgs.push("-u", options.user);
    }
    cmdArgs.push("manticore", ...args);
    return execFileSync("docker", cmdArgs, {
        cwd: REPO_ROOT,
        encoding: "utf8",
    });
}

export function reindexSearchTables(
    tables: Array<"games" | "users"> = ["games", "users"],
): string {
    return execInSearchManticore(
        ["/bin/bash", "/etc/manticoresearch/reindex.sh", ...tables],
        { user: "manticore" },
    );
}

export function spawnReindexInManticore(
    tables: Array<"games" | "users"> = ["games", "users"],
    extraEnv: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
        const envArgs: string[] = [];
        for (const [k, v] of Object.entries(extraEnv)) {
            envArgs.push("-e", `${k}=${v}`);
        }
        const child = spawn(
            "docker",
            [
                "compose",
                "-p",
                SEARCH_TEST_PROJECT,
                "-f",
                SEARCH_TEST_COMPOSE_FILE,
                "exec",
                "-T",
                "-u",
                "manticore",
                ...envArgs,
                "manticore",
                "/bin/bash",
                "/etc/manticoresearch/reindex.sh",
                ...tables,
            ],
            {
                cwd: REPO_ROOT,
            },
        );
        let output = "";
        child.stdout.on("data", (d) => {
            output += d.toString();
        });
        child.stderr.on("data", (d) => {
            output += d.toString();
        });
        child.on("close", (code) => {
            resolve({ code: code ?? 1, output });
        });
    });
}

export async function queryManticoreRaw(body: Record<string, unknown>) {
    const { manticore } = getSearchTestEnv();
    const res = await axios.post(`${manticore.url}/search`, body, {
        timeout: 5000,
    });
    return res.data;
}
