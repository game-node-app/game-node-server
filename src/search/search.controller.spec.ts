import {
    INestApplication,
    MiddlewareConsumer,
    Module,
    NestModule,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test, TestingModule } from "@nestjs/testing";
import { json } from "express";
import request from "supertest";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import { AuthMiddleware } from "../auth/auth.middleware";
import { SupertokensExceptionFilter } from "../auth/auth.filter";
import { AxiosExceptionFilter } from "../filter/axios-exception.filter";
import { SQLExceptionFilter } from "../filter/sql-exception.filter";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import {
    GameAutocompleteResponseDto,
    GameSearchResponseDto,
} from "./dto/game-search-response.dto";
import { UserSearchResponseDto } from "./dto/user-search-response.dto";

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

@Module({
    controllers: [SearchController],
    providers: [
        {
            provide: SearchService,
            useValue: {
                searchGames: jest.fn().mockResolvedValue({
                    data: { items: [], took: 1 },
                    pagination: {
                        totalItems: 0,
                        totalPages: 0,
                        hasNextPage: false,
                    },
                }),
                autocompleteGames: jest.fn().mockResolvedValue({
                    data: [],
                    total: 0,
                }),
                searchUsers: jest.fn().mockResolvedValue({
                    data: { items: [], took: 1 },
                    pagination: {
                        totalItems: 0,
                        totalPages: 0,
                        hasNextPage: false,
                    },
                }),
            },
        },
    ],
})
class TestSearchAppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(AuthMiddleware).forRoutes("*");
    }
}

describe("SearchController (routes, versioning, CORS, OpenAPI, and strict validation)", () => {
    let app: INestApplication;
    let searchService: jest.Mocked<SearchService>;

    beforeAll(async () => {
        ensureSupertokensInitialized();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [TestSearchAppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        searchService = moduleFixture.get(SearchService);

        app.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: "1",
        });

        app.useGlobalFilters(
            new SQLExceptionFilter(),
            new AxiosExceptionFilter(),
            new SupertokensExceptionFilter(),
        );

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

        app.use(json({ limit: "15mb" }));

        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe.each([
        ["/search/games", { query: "zelda" }, "searchGames"],
        ["/v1/search/games", { query: "zelda" }, "searchGames"],
        ["/search/games/autocomplete", { query: "zel" }, "autocompleteGames"],
        ["/v1/search/games/autocomplete", { query: "zel" }, "autocompleteGames"],
        ["/search/users", { query: "cassi" }, "searchUsers"],
        ["/v1/search/users", { query: "cassi" }, "searchUsers"],
    ] as const)(
        "POST %s",
        (path, payload, serviceMethod) => {
            it("returns 200 JSON without authentication", async () => {
                const response = await request(app.getHttpServer())
                    .post(path)
                    .send(payload)
                    .expect(200)
                    .expect("Content-Type", /application\/json/);

                expect(searchService[serviceMethod]).toHaveBeenCalledTimes(1);
                expect(response.body).toBeDefined();
            });

            it("supports unauthenticated browser CORS preflight OPTIONS and cross-origin POST", async () => {
                const origin = "https://gamenode.app";

                const preflight = await request(app.getHttpServer())
                    .options(path)
                    .set("Origin", origin)
                    .set("Access-Control-Request-Method", "POST")
                    .set(
                        "Access-Control-Request-Headers",
                        "content-type,st-auth-mode",
                    )
                    .expect(204);

                expect(preflight.headers["access-control-allow-origin"]).toBe(
                    origin,
                );
                expect(
                    preflight.headers["access-control-allow-credentials"],
                ).toBe("true");

                const postResponse = await request(app.getHttpServer())
                    .post(path)
                    .set("Origin", origin)
                    .send(payload)
                    .expect(200);

                expect(
                    postResponse.headers["access-control-allow-origin"],
                ).toBe(origin);
            });
        },
    );

    describe("OpenAPI / Swagger contract", () => {
        it("registers all six paths with distinct operationIds and legacy request/response schemas", () => {
            const swaggerConfig = new DocumentBuilder()
                .setTitle("GameNode API")
                .setVersion("1.0")
                .build();
            const doc = SwaggerModule.createDocument(app, swaggerConfig);

            const expectedPaths = [
                "/search/games",
                "/v1/search/games",
                "/search/games/autocomplete",
                "/v1/search/games/autocomplete",
                "/search/users",
                "/v1/search/users",
            ];

            const operationIds = new Set<string>();
            for (const path of expectedPaths) {
                const postOp = doc.paths[path]?.post;
                expect(postOp).toBeDefined();
                expect(postOp?.tags).toContain("search");
                expect(postOp?.responses?.["200"]).toBeDefined();
                expect(postOp?.responses?.["400"]).toBeDefined();
                expect(postOp?.operationId).toBeTruthy();
                operationIds.add(postOp!.operationId!);
            }
            expect(operationIds.size).toBe(expectedPaths.length);

            const schemas = doc.components?.schemas as Record<string, any>;
            expect(schemas).toBeDefined();

            const gameReq = schemas.GameSearchRequestDto;
            expect(gameReq.properties.query.type).toBe("string");
            expect(gameReq.properties.category.type).toBe("array");
            expect(gameReq.properties.status.type).toBe("array");
            expect(gameReq.properties.genres.type).toBe("array");
            expect(gameReq.properties.themes.type).toBe("array");
            expect(gameReq.properties.platforms.type).toBe("array");
            expect(gameReq.properties.limit.type).toBe("number");
            expect(gameReq.properties.page.type).toBe("number");
            expect(gameReq.properties.profile.type).toBe("boolean");

            const userReq = schemas.UserSearchRequestDto;
            expect(userReq.properties.query.type).toBe("string");
            expect(userReq.required).toContain("query");
            expect(userReq.properties.limit.type).toBe("number");
            expect(userReq.properties.page.type).toBe("number");

            const searchGame = schemas.SearchGameDto;
            expect(searchGame.required).toEqual(
                expect.arrayContaining([
                    "id",
                    "name",
                    "slug",
                    "category",
                    "status",
                    "createdAt",
                    "updatedAt",
                    "source",
                ]),
            );
            for (const optionalField of [
                "summary",
                "storyline",
                "checksum",
                "aggregatedRating",
                "aggregatedRatingCount",
                "firstReleaseDate",
                "coverUrl",
                "genresNames",
                "themesNames",
                "platformsNames",
                "platformsAbbreviations",
                "keywordsNames",
                "numLikes",
                "numViews",
            ]) {
                expect(searchGame.properties[optionalField]).toBeDefined();
                expect(searchGame.required).not.toContain(optionalField);
            }

            const pagination = schemas.SearchPaginationInfoDto;
            expect(pagination.required).toEqual(
                expect.arrayContaining([
                    "totalItems",
                    "totalPages",
                    "hasNextPage",
                ]),
            );

            const autocompleteRes = schemas.GameAutocompleteResponseDto;
            expect(autocompleteRes.required).toEqual(
                expect.arrayContaining(["data", "total"]),
            );

            const userDto = schemas.SearchUserDto;
            expect(Object.keys(userDto.properties).sort()).toEqual([
                "userId",
                "username",
            ]);
        });

        it("returns representative flattened game, autocomplete, and user payload fixtures identically on legacy and v1 routes", async () => {
            const gameFixture: GameSearchResponseDto = {
                data: {
                    took: 3,
                    items: [
                        {
                            id: 1942,
                            name: "The Witcher 3: Wild Hunt",
                            slug: "the-witcher-3-wild-hunt",
                            category: 0,
                            status: 0,
                            firstReleaseDate: "2015-05-19T00:00:00.000Z",
                            createdAt: "2024-01-01T00:00:00.000Z",
                            updatedAt: "2024-01-02T00:00:00.000Z",
                            coverUrl:
                                "//images.igdb.com/igdb/image/upload/t_thumb/co1wyy.jpg",
                            genresNames: "Adventure, Role-playing (RPG)",
                            themesNames: "Action, Fantasy, Open world",
                            platformsNames:
                                "PC (Microsoft Windows), PlayStation 4, Xbox One",
                            platformsAbbreviations: "PC, PS4, XONE",
                            keywordsNames: "magic, monster hunter",
                            numLikes: 42,
                            numViews: 108,
                            source: "manticore",
                        },
                    ],
                },
                pagination: {
                    totalItems: 1,
                    totalPages: 1,
                    hasNextPage: false,
                },
            };

            const autocompleteFixture: GameAutocompleteResponseDto = {
                data: [
                    "The Witcher 3: Wild Hunt",
                    "The Witcher 2: Assassins of Kings",
                ],
                total: 2,
            };

            const userFixture: UserSearchResponseDto = {
                data: {
                    took: 1,
                    items: [
                        {
                            userId: "ab42f9ec-2f93-4780-9a1b-1234567890ab",
                            username: "geralt",
                        },
                    ],
                },
                pagination: {
                    totalItems: 1,
                    totalPages: 1,
                    hasNextPage: false,
                },
            };

            searchService.searchGames.mockResolvedValue(gameFixture);
            searchService.autocompleteGames.mockResolvedValue(
                autocompleteFixture,
            );
            searchService.searchUsers.mockResolvedValue(userFixture);

            for (const path of ["/search/games", "/v1/search/games"]) {
                const res = await request(app.getHttpServer())
                    .post(path)
                    .send({ query: "witcher" })
                    .expect(200);
                expect(res.body).toEqual(gameFixture);
            }

            for (const path of [
                "/search/games/autocomplete",
                "/v1/search/games/autocomplete",
            ]) {
                const res = await request(app.getHttpServer())
                    .post(path)
                    .send({ query: "witch" })
                    .expect(200);
                expect(res.body).toEqual(autocompleteFixture);
            }

            for (const path of ["/search/users", "/v1/search/users"]) {
                const res = await request(app.getHttpServer())
                    .post(path)
                    .send({ query: "ger" })
                    .expect(200);
                expect(res.body).toEqual(userFixture);
            }
        });
    });

    describe("Strict boundary validation and limits", () => {
        it("accepts valid boundary values on game search and autocomplete", async () => {
            const maxQuery = "a".repeat(256);
            const maxFilterString = "b".repeat(256);
            const maxFilterArray = Array.from(
                { length: 100 },
                (_, i) => `item-${i}`,
            );
            const maxCategoryArray = Array.from({ length: 100 }, () => 0);
            const maxStatusArray = Array.from({ length: 100 }, () => 2);

            await request(app.getHttpServer())
                .post("/search/games")
                .send({
                    query: maxQuery,
                    category: maxCategoryArray,
                    status: maxStatusArray,
                    genres: [maxFilterString, ...maxFilterArray.slice(1)],
                    themes: maxFilterArray,
                    platforms: maxFilterArray,
                    limit: 100,
                    page: 101, // (101 - 1) * 100 = 10000 (exact max offset)
                    profile: true,
                })
                .expect(200);

            // Omitted/zero pagination defaults and empty query
            await request(app.getHttpServer())
                .post("/search/games")
                .send({
                    query: "",
                    limit: 0,
                    page: 0,
                    profile: false,
                })
                .expect(200);

            // Default limit (20) with page 501 => offset = 500 * 20 = 10000
            await request(app.getHttpServer())
                .post("/search/games")
                .send({
                    page: 501,
                })
                .expect(200);

            await request(app.getHttpServer())
                .post("/search/games/autocomplete")
                .send({
                    query: "",
                    limit: 100,
                    page: 3,
                })
                .expect(200);

            await request(app.getHttpServer())
                .post("/search/users")
                .send({
                    query: maxQuery,
                    limit: 100,
                    page: 101,
                })
                .expect(200);

            expect(searchService.searchGames).toHaveBeenCalledTimes(3);
            expect(searchService.autocompleteGames).toHaveBeenCalledTimes(1);
            expect(searchService.searchUsers).toHaveBeenCalledTimes(1);
        });

        it.each([
            ["non-string query (number)", { query: 123 }],
            ["non-string query (boolean)", { query: true }],
            ["null query", { query: null }],
            ["query length 257", { query: "a".repeat(257) }],
            ["non-array category", { category: 0 }],
            ["string element in category", { category: ["0"] }],
            ["float element in category", { category: [1.5] }],
            ["out-of-range category (15)", { category: [15] }],
            ["negative category (-1)", { category: [-1] }],
            ["category array length 101", { category: Array(101).fill(0) }],
            ["non-array status", { status: 0 }],
            ["string element in status", { status: ["0"] }],
            ["unassigned status enum gap (1)", { status: [1] }],
            ["out-of-range status (9)", { status: [9] }],
            ["status array length 101", { status: Array(101).fill(0) }],
            ["non-array genres", { genres: "Action" }],
            ["non-string in genres", { genres: [123] }],
            ["null in genres", { genres: [null] }],
            ["genres element length 257", { genres: ["g".repeat(257)] }],
            ["genres array length 101", { genres: Array(101).fill("Action") }],
            ["non-string in themes", { themes: [false] }],
            ["themes element length 257", { themes: ["t".repeat(257)] }],
            ["themes array length 101", { themes: Array(101).fill("Fantasy") }],
            ["non-string in platforms", { platforms: [{}] }],
            ["platforms element length 257", { platforms: ["p".repeat(257)] }],
            ["platforms array length 101", { platforms: Array(101).fill("PC") }],
            ["string limit despite implicit conversion", { limit: "20" }],
            ["boolean limit", { limit: true }],
            ["fractional limit", { limit: 10.5 }],
            ["negative limit", { limit: -1 }],
            ["limit 101 (> 100)", { limit: 101 }],
            ["null limit", { limit: null }],
            ["string page despite implicit conversion", { page: "1" }],
            ["boolean page", { page: false }],
            ["fractional page", { page: 1.5 }],
            ["negative page", { page: -1 }],
            ["null page", { page: null }],
            ["offset 10100 (> 10000) with limit 100, page 102", { limit: 100, page: 102 }],
            ["offset 10020 (> 10000) with default limit 20, page 502", { page: 502 }],
            ["unsafe integer page", { page: Number.MAX_SAFE_INTEGER }],
            ["string profile despite implicit conversion", { profile: "true" }],
            ["numeric profile", { profile: 1 }],
            ["null profile", { profile: null }],
        ])(
            "rejects invalid game search payload (%s) with 400 before calling SearchService",
            async (_label, invalidBody) => {
                await request(app.getHttpServer())
                    .post("/search/games")
                    .send(invalidBody as object)
                    .expect(400);

                await request(app.getHttpServer())
                    .post("/search/games/autocomplete")
                    .send(invalidBody as object)
                    .expect(400);

                expect(searchService.searchGames).not.toHaveBeenCalled();
                expect(searchService.autocompleteGames).not.toHaveBeenCalled();
            },
        );

        it.each([
            ["missing query", {}],
            ["empty query", { query: "" }],
            ["whitespace-only query", { query: "   \t\n  " }],
            ["non-string query", { query: 123 }],
            ["query length 257", { query: "u".repeat(257) }],
            ["string limit", { query: "cassi", limit: "10" }],
            ["negative limit", { query: "cassi", limit: -5 }],
            ["limit 101", { query: "cassi", limit: 101 }],
            ["string page", { query: "cassi", page: "2" }],
            ["negative page", { query: "cassi", page: -1 }],
            ["fractional page", { query: "cassi", page: 2.5 }],
            ["offset > 10000", { query: "cassi", limit: 100, page: 102 }],
        ])(
            "rejects invalid user search payload (%s) with 400 before calling SearchService",
            async (_label, invalidBody) => {
                await request(app.getHttpServer())
                    .post("/search/users")
                    .send(invalidBody as object)
                    .expect(400);

                expect(searchService.searchUsers).not.toHaveBeenCalled();
            },
        );

        it("rejects malformed JSON and non-object JSON array bodies with 400 before calling SearchService", async () => {
            for (const path of [
                "/search/games",
                "/v1/search/games",
                "/search/games/autocomplete",
                "/v1/search/games/autocomplete",
                "/search/users",
                "/v1/search/users",
            ]) {
                await request(app.getHttpServer())
                    .post(path)
                    .set("Content-Type", "application/json")
                    .send("{malformed-json")
                    .expect(400);

                await request(app.getHttpServer())
                    .post(path)
                    .set("Content-Type", "application/json")
                    .send(JSON.stringify([{ query: "zelda" }]))
                    .expect(400);

                await request(app.getHttpServer())
                    .post(path)
                    .set("Content-Type", "application/json")
                    .send(JSON.stringify([]))
                    .expect(400);
            }

            expect(searchService.searchGames).not.toHaveBeenCalled();
            expect(searchService.autocompleteGames).not.toHaveBeenCalled();
            expect(searchService.searchUsers).not.toHaveBeenCalled();
        });
    });
});
