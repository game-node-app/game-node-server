import {
    BadGatewayException,
    BadRequestException,
    GatewayTimeoutException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Test, TestingModule } from "@nestjs/testing";
import { AxiosError, AxiosHeaders, AxiosResponse } from "axios";
import { of, throwError } from "rxjs";
import { GameGenre } from "../game/game-repository/entities/game-genre.entity";
import { GamePlatform } from "../game/game-repository/entities/game-platform.entity";
import { GameTheme } from "../game/game-repository/entities/game-theme.entity";
import { SearchModule } from "./search.module";
import { SearchService } from "./search.service";
import {
    SEARCH_ENGINE_TIMEOUT_MS,
    SEARCH_GAMES_TABLE,
    SEARCH_USERS_TABLE,
} from "./search.constants";

interface MockResourceRow {
    id: number;
    name: string;
    abbreviation?: string;
}

function createMockResourceRepository(rows: MockResourceRow[]) {
    const createQueryBuilder = jest.fn(() => {
        let whereClause = "";
        let whereParams: Record<string, unknown> = {};

        const qb: {
            select: jest.Mock;
            where: jest.Mock;
            getMany: jest.Mock;
        } = {
            select: jest.fn().mockReturnThis(),
            where: jest.fn(
                (clause: string, params: Record<string, unknown>) => {
                    whereClause = clause;
                    whereParams = params;
                    return qb;
                },
            ),
            getMany: jest.fn(async () => {
                const candidateIds = new Set<number>(
                    (whereParams.candidateIds as number[]) ?? [],
                );
                const lowerTokens = new Set<string>(
                    (whereParams.lowerTokens as string[]) ?? [],
                );
                const checkAbbreviation = whereClause.includes(
                    "LOWER(resource.abbreviation)",
                );

                return rows
                    .filter((row) => {
                        if (candidateIds.has(row.id)) {
                            return true;
                        }
                        if (lowerTokens.has(row.name.toLowerCase())) {
                            return true;
                        }
                        if (
                            checkAbbreviation &&
                            row.abbreviation &&
                            lowerTokens.has(row.abbreviation.toLowerCase())
                        ) {
                            return true;
                        }
                        return false;
                    })
                    .map((row) => ({ id: row.id }));
            }),
        };

        return qb;
    });

    return {
        createQueryBuilder,
    };
}

function makeAxiosResponse<T>(data: T, status = 200): AxiosResponse<T> {
    return {
        data,
        status,
        statusText: "OK",
        headers: {},
        config: {
            headers: new AxiosHeaders(),
        },
    };
}

function makeAxiosError(options: {
    code?: string;
    message?: string;
    status?: number;
    data?: unknown;
}): AxiosError {
    const headers = new AxiosHeaders();
    const config = {
        url: "http://user:secret-pass@manticore-internal:9308/search",
        headers,
    };
    const response =
        options.status !== undefined
            ? {
                  data: options.data ?? {
                      error: "internal SQL syntax failure near SELECT * FROM secret_table",
                  },
                  status: options.status,
                  statusText: "Error",
                  headers: {},
                  config,
              }
            : undefined;

    return new AxiosError(
        options.message ?? "Request failed",
        options.code,
        config,
        {},
        response,
    );
}

describe("SearchService", () => {
    let service: SearchService;
    let httpService: { post: jest.Mock };
    let genreRepo: ReturnType<typeof createMockResourceRepository>;
    let themeRepo: ReturnType<typeof createMockResourceRepository>;
    let platformRepo: ReturnType<typeof createMockResourceRepository>;

    beforeEach(async () => {
        httpService = {
            post: jest.fn(),
        };
        genreRepo = createMockResourceRepository([
            { id: 12, name: "Role-playing (RPG)" },
            { id: 31, name: "Adventure" },
        ]);
        themeRepo = createMockResourceRepository([
            { id: 1, name: "Action" },
            { id: 17, name: "Fantasy" },
        ]);
        platformRepo = createMockResourceRepository([
            {
                id: 6,
                name: "PC (Microsoft Windows)",
                abbreviation: "PC",
            },
            {
                id: 48,
                name: "PlayStation 4",
                abbreviation: "PS4",
            },
            {
                id: 130,
                name: "Nintendo Switch",
                abbreviation: "Switch",
            },
        ]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                SearchService,
                {
                    provide: HttpService,
                    useValue: httpService,
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key: string) =>
                            key === "MANTICORE_URL"
                                ? "http://localhost:9308"
                                : undefined,
                        ),
                    },
                },
                {
                    provide: getRepositoryToken(GameGenre),
                    useValue: genreRepo,
                },
                {
                    provide: getRepositoryToken(GameTheme),
                    useValue: themeRepo,
                },
                {
                    provide: getRepositoryToken(GamePlatform),
                    useValue: platformRepo,
                },
            ],
        }).compile();

        service = module.get<SearchService>(SearchService);
    });

    describe("2.1 Shared HTTP engine path, timeout, startup independence, and controlled error mapping", () => {
        it("boots SearchModule without contacting Manticore during module initialization", async () => {
            const moduleRef = await Test.createTestingModule({
                imports: [
                    ConfigModule.forRoot({
                        isGlobal: true,
                        ignoreEnvFile: true,
                        load: [
                            () => ({
                                MANTICORE_URL: "http://127.0.0.1:59999",
                            }),
                        ],
                    }),
                    SearchModule,
                ],
            }).compile();

            await moduleRef.init();
            const resolvedService = moduleRef.get(SearchService);
            expect(resolvedService).toBeDefined();
            await moduleRef.close();
        });

        it("sends POST /search to configured MANTICORE_URL with 5000ms timeout and fixed table/fields", async () => {
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 2,
                        timed_out: false,
                        hits: {
                            total: 0,
                            total_relation: "eq",
                            hits: [],
                        },
                    }),
                ),
            );

            await service.searchGames({ query: "halo" });

            expect(httpService.post).toHaveBeenCalledTimes(1);
            const [url, body, config] = httpService.post.mock.calls[0];
            expect(url).toBe("http://localhost:9308/search");
            expect(body.table).toBe(SEARCH_GAMES_TABLE);
            expect(config.timeout).toBe(SEARCH_ENGINE_TIMEOUT_MS);
        });

        it.each([
            [
                "connection refused (ECONNREFUSED)",
                makeAxiosError({
                    code: "ECONNREFUSED",
                    message:
                        "connect ECONNREFUSED 127.0.0.1:9308 (http://admin:supersecret@manticore:9308)",
                }),
            ],
            [
                "DNS lookup failure (ENOTFOUND)",
                makeAxiosError({
                    code: "ENOTFOUND",
                    message: "getaddrinfo ENOTFOUND manticore-secret-host",
                }),
            ],
            [
                "upstream HTTP 503",
                makeAxiosError({
                    code: "ERR_BAD_RESPONSE",
                    status: 503,
                    data: "Manticore daemon overloaded: sql_pass=secret",
                }),
            ],
        ])(
            "maps engine unavailability (%s) to controlled 503 without leaking upstream details",
            async (_label, error) => {
                httpService.post.mockReturnValueOnce(throwError(() => error));

                await expect(
                    service.searchGames({ query: "zelda" }),
                ).rejects.toMatchObject({
                    status: 503,
                    message: "Search service is currently unavailable",
                });
            },
        );

        it.each([
            [
                "Axios timeout (ECONNABORTED)",
                makeAxiosError({
                    code: "ECONNABORTED",
                    message: `timeout of ${SEARCH_ENGINE_TIMEOUT_MS}ms exceeded`,
                }),
            ],
            [
                "socket timeout (ETIMEDOUT)",
                makeAxiosError({
                    code: "ETIMEDOUT",
                    message: "connect ETIMEDOUT",
                }),
            ],
            [
                "upstream HTTP 504",
                makeAxiosError({
                    status: 504,
                    data: "gateway timeout from upstream proxy",
                }),
            ],
        ])(
            "maps engine timeout (%s) to controlled 504 GatewayTimeoutException",
            async (_label, error) => {
                httpService.post.mockReturnValueOnce(throwError(() => error));

                try {
                    await service.searchUsers({ query: "cassi" });
                    fail("Expected GatewayTimeoutException");
                } catch (err) {
                    expect(err).toBeInstanceOf(GatewayTimeoutException);
                    const res = (err as GatewayTimeoutException).getResponse();
                    expect(JSON.stringify(res)).not.toContain("secret");
                    expect(JSON.stringify(res)).not.toContain("manticore-internal");
                }
            },
        );

        it.each([
            [
                "explicit engine error object",
                makeAxiosResponse({
                    error: "table games absent in /var/lib/manticore",
                }),
            ],
            [
                "timed_out: true partial result",
                makeAxiosResponse({
                    took: 5001,
                    timed_out: true,
                    hits: {
                        total: 10,
                        total_relation: "eq",
                        hits: [],
                    },
                }),
            ],
            [
                "lower-bound total_relation: gte",
                makeAxiosResponse({
                    took: 4,
                    timed_out: false,
                    hits: {
                        total: 1000,
                        total_relation: "gte",
                        hits: [],
                    },
                }),
            ],
            ["non-object response body", makeAxiosResponse("<html>502</html>")],
            ["array response body", makeAxiosResponse([])],
            ["missing hits object", makeAxiosResponse({ took: 1 })],
            [
                "negative total count",
                makeAxiosResponse({
                    hits: { total: -1, hits: [] },
                }),
            ],
            [
                "non-array hits.hits",
                makeAxiosResponse({
                    hits: { total: 1, hits: "bad" },
                }),
            ],
            [
                "hit missing _source",
                makeAxiosResponse({
                    hits: { total: 1, hits: [{ _id: 1 }] },
                }),
            ],
        ])(
            "maps malformed or failed engine payload (%s) to controlled 502 BadGatewayException",
            async (_label, response) => {
                httpService.post.mockReturnValueOnce(of(response));

                await expect(
                    service.searchGames({ query: "zelda" }),
                ).rejects.toThrow(BadGatewayException);
            },
        );

        it("maps upstream HTTP 500 error to controlled 502 without leaking upstream SQL or credentials", async () => {
            const logSpy = jest.spyOn((service as any).logger, "error");
            httpService.post.mockReturnValueOnce(
                throwError(() =>
                    makeAxiosError({
                        code: "ERR_BAD_RESPONSE",
                        status: 500,
                        data: {
                            error: "sql_pass=super_secret_password query failed",
                        },
                    }),
                ),
            );

            try {
                await service.searchGames({ query: "zelda" });
                fail("Expected BadGatewayException");
            } catch (err) {
                expect(err).toBeInstanceOf(BadGatewayException);
                expect(JSON.stringify((err as BadGatewayException).getResponse())).toBe(
                    JSON.stringify({
                        message: "Invalid response from search engine",
                        error: "Bad Gateway",
                        statusCode: 502,
                    }),
                );
            }

            expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
                "super_secret_password",
            );
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
                "secret-pass",
            );
        });
    });

    describe("2.2 Game queries, category/status IN filters, filter-only match-all, and deterministic sort", () => {
        it("builds anchored phrase query on name,alternative_names with category/status IN filters and ordered sort", async () => {
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 3,
                        timed_out: false,
                        hits: {
                            total: 0,
                            total_relation: "eq",
                            hits: [],
                        },
                    }),
                ),
            );

            await service.searchGames({
                query: "Chrono Trigger",
                category: [0, 8],
                status: [0, 4],
                page: 2,
                limit: 15,
            });

            const [, requestBody] = httpService.post.mock.calls[0];
            expect(requestBody).toEqual({
                table: SEARCH_GAMES_TABLE,
                query: {
                    bool: {
                        must: [
                            {
                                match_phrase: {
                                    "name,alternative_names": "^Chrono Trigger",
                                },
                            },
                            {
                                in: {
                                    category: [0, 8],
                                },
                            },
                            {
                                in: {
                                    status: [0, 4],
                                },
                            },
                        ],
                    },
                },
                limit: 15,
                offset: 15,
                sort: [
                    { _score: "desc" },
                    { num_views: "desc" },
                    { first_release_date: "desc" },
                    { id: "asc" },
                ],
                track_total_hits: true,
                options: {
                    max_matches: 10100,
                },
            });
        });

        it("supports filter-only discovery when query is empty or omitted and match_all when no filters are supplied", async () => {
            httpService.post
                .mockReturnValueOnce(
                    of(
                        makeAxiosResponse({
                            took: 1,
                            hits: { total: 0, total_relation: "eq", hits: [] },
                        }),
                    ),
                )
                .mockReturnValueOnce(
                    of(
                        makeAxiosResponse({
                            took: 1,
                            hits: { total: 0, total_relation: "eq", hits: [] },
                        }),
                    ),
                );

            await service.searchGames({
                query: "",
                category: [0],
            });

            const [, filterOnlyBody] = httpService.post.mock.calls[0];
            expect(filterOnlyBody.query).toEqual({
                bool: {
                    must: [
                        {
                            in: {
                                category: [0],
                            },
                        },
                    ],
                },
            });

            await service.searchGames({});
            const [, matchAllBody] = httpService.post.mock.calls[1];
            expect(matchAllBody.query).toEqual({
                match_all: {},
            });
        });
    });

    describe("2.3 Explicit game/user response mapping, sparse rows, epoch release dates, and allowlists", () => {
        it("maps populated and sparse game hits with legacy field omission, epoch release date, numeric IDs, and allowlist filtering", async () => {
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 5,
                        timed_out: false,
                        profile: { query: { status: "internal-profile" } },
                        hits: {
                            total: 2,
                            total_relation: "eq",
                            hits: [
                                {
                                    _id: "1942",
                                    _score: 1250,
                                    _source: {
                                        id: 1942,
                                        name: "The Witcher 3: Wild Hunt",
                                        slug: "the-witcher-3-wild-hunt",
                                        summary: "Ignored in SQL but mapped if present",
                                        category: 0,
                                        status: 0,
                                        first_release_date: 1431993600,
                                        created_at: 1704067200,
                                        updated_at: 1704153600,
                                        cover_url:
                                            "//images.igdb.com/igdb/image/upload/t_thumb/co1wyy.jpg",
                                        genres_names:
                                            "Adventure, Role-playing (RPG)",
                                        themes_names: "Action, Fantasy",
                                        platforms_names:
                                            "PC (Microsoft Windows), PlayStation 4",
                                        platforms_abbreviations: "PC, PS4",
                                        keywords_names: "witcher, geralt",
                                        num_likes: 42,
                                        num_views: 108,
                                        source: "manticore",
                                        url: "https://www.igdb.com/games/the-witcher-3-wild-hunt",
                                        alternative_names: "Dziki Gon",
                                        genre_ids: [12, 31],
                                        theme_ids: [1, 17],
                                        platform_ids: [6, 48],
                                    },
                                },
                                {
                                    _id: 2001,
                                    _score: 1100,
                                    _source: {
                                        id: 2001,
                                        name: "Mystery Indie Prototype",
                                        slug: "mystery-indie-prototype",
                                        category: 0,
                                        status: 2,
                                        first_release_date: 0,
                                        created_at: 1704067200,
                                        updated_at: 1704067200,
                                        cover_url: "",
                                        genres_names: "",
                                        themes_names: undefined,
                                        platforms_names: null,
                                        platforms_abbreviations: "",
                                        keywords_names: "",
                                        num_likes: 0,
                                        num_views: 0,
                                        source: "manticore",
                                    },
                                },
                            ],
                        },
                    }),
                ),
            );

            const result = await service.searchGames({
                query: "witcher",
                profile: true,
            });

            expect(result.data.took).toBe(5);
            expect("profile" in result.data).toBe(false);
            expect(result.data.items).toHaveLength(2);

            const populated = result.data.items[0];
            expect(populated).toEqual({
                id: 1942,
                name: "The Witcher 3: Wild Hunt",
                slug: "the-witcher-3-wild-hunt",
                summary: "Ignored in SQL but mapped if present",
                category: 0,
                status: 0,
                firstReleaseDate: "2015-05-19T00:00:00.000Z",
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-02T00:00:00.000Z",
                coverUrl:
                    "//images.igdb.com/igdb/image/upload/t_thumb/co1wyy.jpg",
                genresNames: "Adventure, Role-playing (RPG)",
                themesNames: "Action, Fantasy",
                platformsNames: "PC (Microsoft Windows), PlayStation 4",
                platformsAbbreviations: "PC, PS4",
                keywordsNames: "witcher, geralt",
                numLikes: 42,
                numViews: 108,
                source: "manticore",
            });
            expect(typeof populated.id).toBe("number");
            expect("url" in populated).toBe(false);
            expect("alternative_names" in populated).toBe(false);
            expect("genre_ids" in populated).toBe(false);

            const sparse = result.data.items[1];
            expect(sparse).toEqual({
                id: 2001,
                name: "Mystery Indie Prototype",
                slug: "mystery-indie-prototype",
                category: 0,
                status: 2,
                firstReleaseDate: "1970-01-01T00:00:00.000Z",
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
                source: "manticore",
            });
            expect("coverUrl" in sparse).toBe(false);
            expect("genresNames" in sparse).toBe(false);
            expect("themesNames" in sparse).toBe(false);
            expect("platformsNames" in sparse).toBe(false);
            expect("platformsAbbreviations" in sparse).toBe(false);
            expect("keywordsNames" in sparse).toBe(false);
            expect("numLikes" in sparse).toBe(false);
            expect("numViews" in sparse).toBe(false);
        });
    });

    describe("2.4 Pagination offsets, total-derived metadata without 16-bit narrowing, and empty beyond-end pages", () => {
        it("calculates first/last pages, zero results, empty beyond-end pages, user hasNextPage with 21 matches, and totals above 65535 pages", async () => {
            // 1. First page of 21 users (limit 20, page 1) -> hasNextPage: true, totalPages: 2
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 1,
                        hits: {
                            total: 21,
                            total_relation: "eq",
                            hits: Array.from({ length: 20 }, (_, i) => ({
                                _id: i + 1,
                                _source: {
                                    user_id: `user-${i + 1}`,
                                    username: `player_${i + 1}`,
                                },
                            })),
                        },
                    }),
                ),
            );
            const userPage1 = await service.searchUsers({
                query: "player",
                page: 1,
                limit: 20,
            });
            expect(userPage1.pagination).toEqual({
                totalItems: 21,
                totalPages: 2,
                hasNextPage: true,
            });

            // 2. Last page of 21 users (limit 20, page 2) -> 1 item, hasNextPage: false, totalPages: 2
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 1,
                        hits: {
                            total: 21,
                            total_relation: "eq",
                            hits: [
                                {
                                    _id: 21,
                                    _source: {
                                        user_id: "user-21",
                                        username: "player_21",
                                    },
                                },
                            ],
                        },
                    }),
                ),
            );
            const userPage2 = await service.searchUsers({
                query: "player",
                page: 2,
                limit: 20,
            });
            expect(userPage2.data.items).toHaveLength(1);
            expect(userPage2.pagination).toEqual({
                totalItems: 21,
                totalPages: 2,
                hasNextPage: false,
            });

            // 3. Empty page beyond the end (21 games, page 3, limit 20) -> items: [], totalItems: 21, totalPages: 2, hasNextPage: false
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 1,
                        hits: {
                            total: 21,
                            total_relation: "eq",
                            hits: [],
                        },
                    }),
                ),
            );
            const beyondEnd = await service.searchGames({
                query: "zelda",
                page: 3,
                limit: 20,
            });
            expect(beyondEnd.data.items).toEqual([]);
            expect(beyondEnd.pagination).toEqual({
                totalItems: 21,
                totalPages: 2,
                hasNextPage: false,
            });

            // 4. Zero results -> items: [], totalItems: 0, totalPages: 0, hasNextPage: false
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 1,
                        hits: {
                            total: 0,
                            total_relation: "eq",
                            hits: [],
                        },
                    }),
                ),
            );
            const zeroRes = await service.searchUsers({
                query: "nobody",
            });
            expect(zeroRes.data.items).toEqual([]);
            expect(zeroRes.pagination).toEqual({
                totalItems: 0,
                totalPages: 0,
                hasNextPage: false,
            });

            // 5. Large totalPages above uint16 max (65535) without narrowing
            const largePagination = service.buildPaginationInfo(1_500_000, 20, 1);
            expect(largePagination).toEqual({
                totalItems: 1_500_000,
                totalPages: 75_000,
                hasNextPage: true,
            });
        });
    });

    describe("2.5 Game autocomplete prefix matching, forced page 1 / limit 5, and empty-input short circuit", () => {
        it("short-circuits empty or whitespace autocomplete input without calling Manticore", async () => {
            await expect(service.autocompleteGames({})).resolves.toEqual({
                data: [],
                total: 0,
            });
            await expect(
                service.autocompleteGames({ query: "" }),
            ).resolves.toEqual({
                data: [],
                total: 0,
            });
            await expect(
                service.autocompleteGames({ query: "   " }),
            ).resolves.toEqual({
                data: [],
                total: 0,
            });

            expect(httpService.post).not.toHaveBeenCalled();
        });

        it("forces page 1 and limit 5 with prefix query and returns { data, total }", async () => {
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 2,
                        hits: {
                            total: 12,
                            total_relation: "eq",
                            hits: [
                                {
                                    _id: 1,
                                    _source: {
                                        id: 1,
                                        name: "Elden Ring",
                                        slug: "elden-ring",
                                        category: 0,
                                        status: 0,
                                        created_at: 1700000000,
                                        updated_at: 1700000000,
                                        source: "manticore",
                                    },
                                },
                                {
                                    _id: 2,
                                    _source: {
                                        id: 2,
                                        name: "Elden Ring: Shadow of the Erdtree",
                                        slug: "elden-ring-shadow-of-the-erdtree",
                                        category: 2,
                                        status: 0,
                                        created_at: 1700000000,
                                        updated_at: 1700000000,
                                        source: "manticore",
                                    },
                                },
                            ],
                        },
                    }),
                ),
            );

            const res = await service.autocompleteGames({
                query: "elden",
                page: 3,
                limit: 100,
                category: [0, 2],
            });

            expect(res).toEqual({
                data: ["Elden Ring", "Elden Ring: Shadow of the Erdtree"],
                total: 2,
            });

            const [, requestBody] = httpService.post.mock.calls[0];
            expect(requestBody.limit).toBe(5);
            expect(requestBody.offset).toBe(0);
            expect(requestBody.query).toEqual({
                bool: {
                    must: [
                        {
                            match_phrase: {
                                "name,alternative_names": "^elden*",
                            },
                        },
                        {
                            in: {
                                category: [0, 2],
                            },
                        },
                    ],
                },
            });
        });
    });

    describe("2.6 Username prefix search, stable relevance/userId ordering, and public field allowlist", () => {
        it("queries Manticore users table with username prefix and [{ _score: desc }, { user_id: asc }] sort, stripping non-public fields", async () => {
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 1,
                        profile: { query: "hidden" },
                        hits: {
                            total: 2,
                            total_relation: "eq",
                            hits: [
                                {
                                    _id: 99,
                                    _score: 1000,
                                    _source: {
                                        user_id: "user-uuid-a",
                                        username: "cassi_a",
                                        email: "private@example.com",
                                        bio: "secret bio",
                                        created_at: 1700000000,
                                        updated_at: 1700000000,
                                    },
                                },
                                {
                                    _id: 100,
                                    _score: 1000,
                                    _source: {
                                        user_id: "user-uuid-b",
                                        username: "cassi_b",
                                        created_at: 1700000000,
                                        updated_at: 1700000000,
                                    },
                                },
                            ],
                        },
                    }),
                ),
            );

            const result = await service.searchUsers({
                query: "cassi",
                page: 1,
                limit: 20,
            });

            const [, requestBody] = httpService.post.mock.calls[0];
            expect(requestBody).toEqual({
                table: SEARCH_USERS_TABLE,
                query: {
                    match: {
                        username: "cassi*",
                    },
                },
                limit: 20,
                offset: 0,
                sort: [{ _score: "desc" }, { user_id: "asc" }],
                track_total_hits: true,
                options: {
                    max_matches: 10100,
                },
            });

            expect("profile" in result.data).toBe(false);
            expect(result.data.items).toEqual([
                {
                    userId: "user-uuid-a",
                    username: "cassi_a",
                },
                {
                    userId: "user-uuid-b",
                    username: "cassi_b",
                },
            ]);
            expect(Object.keys(result.data.items[0])).toEqual([
                "userId",
                "username",
            ]);
        });

        it("rejects blank username queries directly in SearchService", async () => {
            await expect(
                service.searchUsers({ query: "   " }),
            ).rejects.toThrow(BadRequestException);
            expect(httpService.post).not.toHaveBeenCalled();
        });
    });

    describe("3.4 Relation filter resolution (genres, themes, platforms) and multi-filter engine predicates", () => {
        it("resolves case-insensitive resource names, decimal IDs, and platform abbreviations with OR within fields and AND across all 5 filter families", async () => {
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 2,
                        hits: {
                            total: 1,
                            total_relation: "eq",
                            hits: [
                                {
                                    _id: 10,
                                    _source: {
                                        id: 10,
                                        name: "Chrono Trigger",
                                        slug: "chrono-trigger",
                                        category: 0,
                                        status: 0,
                                        first_release_date: 794880000,
                                        created_at: 1700000000,
                                        updated_at: 1700000000,
                                        source: "manticore",
                                    },
                                },
                            ],
                        },
                    }),
                ),
            );

            const result = await service.searchGames({
                query: "Chrono",
                category: [0],
                status: [0],
                genres: ["role-playing (rpg)", "31", "unknown-genre"],
                themes: ["FANTASY", "1", "nonexistent-theme"],
                platforms: ["ps4", "PC (Microsoft Windows)", "130", "999999"],
            });

            expect(result.pagination.totalItems).toBe(1);
            expect(genreRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
            expect(themeRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
            expect(platformRepo.createQueryBuilder).toHaveBeenCalledTimes(1);

            const [, requestBody] = httpService.post.mock.calls[0];
            expect(requestBody.query).toEqual({
                bool: {
                    must: [
                        {
                            match_phrase: {
                                "name,alternative_names": "^Chrono",
                            },
                        },
                        {
                            in: {
                                category: [0],
                            },
                        },
                        {
                            in: {
                                status: [0],
                            },
                        },
                        {
                            in: {
                                genre_ids: [12, 31],
                            },
                        },
                        {
                            in: {
                                theme_ids: [1, 17],
                            },
                        },
                        {
                            in: {
                                platform_ids: [6, 48, 130],
                            },
                        },
                    ],
                },
            });
        });

        it("short-circuits to empty result without calling Manticore when any populated relation filter resolves to zero IDs", async () => {
            const result = await service.searchGames({
                query: "Chrono",
                genres: ["role-playing (rpg)"],
                themes: ["completely-unknown-theme", "999999"],
                platforms: ["PC"],
                page: 1,
                limit: 20,
            });

            expect(result).toEqual({
                data: {
                    items: [],
                    took: 0,
                },
                pagination: {
                    totalItems: 0,
                    totalPages: 0,
                    hasNextPage: false,
                },
            });
            expect(httpService.post).not.toHaveBeenCalled();

            const autoRes = await service.autocompleteGames({
                query: "Chrono",
                platforms: ["nonexistent-platform"],
            });
            expect(autoRes).toEqual({
                data: [],
                total: 0,
            });
            expect(httpService.post).not.toHaveBeenCalled();
        });

        it("treats empty relation filter arrays as inactive without querying repositories or short-circuiting", async () => {
            httpService.post.mockReturnValueOnce(
                of(
                    makeAxiosResponse({
                        took: 1,
                        hits: {
                            total: 3,
                            total_relation: "eq",
                            hits: [],
                        },
                    }),
                ),
            );

            const res = await service.searchGames({
                genres: [],
                themes: [],
                platforms: [],
            });

            expect(genreRepo.createQueryBuilder).not.toHaveBeenCalled();
            expect(themeRepo.createQueryBuilder).not.toHaveBeenCalled();
            expect(platformRepo.createQueryBuilder).not.toHaveBeenCalled();
            expect(httpService.post).toHaveBeenCalledTimes(1);
            expect(res.pagination.totalItems).toBe(3);

            const [, requestBody] = httpService.post.mock.calls[0];
            expect(requestBody.query).toEqual({
                match_all: {},
            });
        });
    });
});
