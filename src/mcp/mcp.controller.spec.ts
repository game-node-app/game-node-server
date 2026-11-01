import { INestApplication, VersioningType } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { json } from "express";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { AuthModule } from "../auth/auth.module";
import { AuthService } from "../auth/auth.service";
import { mountAuth } from "../auth/mount-auth";
import { NotificationsModule } from "../notifications/notifications.module";
import { UploadModule } from "../upload/upload.module";
import { Module } from "@nestjs/common";
import { MCP_TOOL_SCOPES } from "./mcp.constants";
import { McpController } from "./mcp.controller";
import { McpToolsService } from "./mcp-tools.service";

/**
 * Real Better Auth (dev MySQL, yarn migration:run first) signs and verifies the tokens; the tools service is
 * stubbed because the tools themselves are covered in mcp-tools.service.spec.ts.
 */

// Stands in for NotificationsModule so the spec doesn't register BullMQ queues against dev Redis.
@Module({})
class NoNotificationsModule {}

jest.setTimeout(60000);

const ACCEPT = "application/json, text/event-stream";
const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
    },
};
const call = (name: string, args: object = {}) => ({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
});

describe("McpController (dev MySQL)", () => {
    let app: INestApplication;
    let authService: AuthService;
    let api: string;
    const userId = randomUUID();
    const tools = {
        searchGames: jest.fn(),
        getGame: jest.fn(),
        getLibraryEntry: jest.fn(),
        listCollections: jest.fn(),
        addGameToLibrary: jest.fn(),
        reviewGame: jest.fn(),
        createPost: jest.fn(),
        listUnmappedGames: jest.fn(),
        mapExternalGame: jest.fn(),
        dismissUnmappedGame: jest.fn(),
    };

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                TypeOrmModule.forRoot({
                    type: "mysql",
                    host: process.env.DB_HOST,
                    port: Number(process.env.DB_PORT),
                    username: process.env.DB_USER,
                    password: process.env.DB_PASS,
                    database: process.env.DB_DATABASE,
                    timezone: "Z",
                    entities: [`${__dirname}/../**/*.entity.ts`],
                    retryAttempts: 0,
                }),
                UploadModule,
                AuthModule,
            ],
            controllers: [McpController],
            providers: [{ provide: McpToolsService, useValue: tools }],
        })
            .overrideModule(NotificationsModule)
            .useModule(NoNotificationsModule)
            .compile();

        app = moduleRef.createNestApplication({ bodyParser: false });
        authService = app.get(AuthService);
        api = app.get(ConfigService).getOrThrow("DOMAIN_API");
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        mountAuth(app.getHttpAdapter().getInstance(), authService);
        app.use(json());
        await app.listen(0);
        // The controller verifies tokens against this process's own JWKS endpoint.
        process.env.SERVER_PORT = String(
            (app.getHttpServer().address() as AddressInfo).port,
        );
    });

    afterAll(async () => {
        delete process.env.SERVER_PORT;
        await app?.close();
    });

    async function token(
        overrides: Record<string, unknown> = {},
        scope = "games:read",
    ) {
        const { token } = await authService.auth.api.signJWT({
            body: {
                payload: {
                    iss: `${api}/v1/auth`,
                    aud: `${api}/v1/mcp`,
                    azp: "test-client",
                    sub: userId,
                    scope,
                    ...overrides,
                },
            },
        });
        return token;
    }

    const post = (body: object, bearer?: string) => {
        const req = request(app.getHttpServer())
            .post("/v1/mcp")
            .set("Accept", ACCEPT);
        return (
            bearer ? req.set("Authorization", `Bearer ${bearer}`) : req
        ).send(body);
    };

    const MAPPING_TOOLS = [
        "list_unmapped_games",
        "map_external_game",
        "dismiss_unmapped_game",
    ];
    const asRoles = (roles: string[]) =>
        jest.spyOn(authService, "getUserRoles").mockResolvedValue(roles);
    const listTools = async (bearer: string) =>
        (
            await post(
                { jsonrpc: "2.0", id: 3, method: "tools/list" },
                bearer,
            ).expect(200)
        ).body.result.tools.map((tool: { name: string }) => tool.name);

    afterEach(() => jest.restoreAllMocks());

    beforeEach(() => {
        for (const tool of Object.values(tools)) {
            tool.mockReset().mockResolvedValue({
                content: [{ type: "text", text: "done" }],
            });
        }
    });

    describe("authentication", () => {
        it("answers a request without a token with the resource metadata challenge", async () => {
            const response = await post(initialize).expect(401);
            expect(response.headers["www-authenticate"]).toContain(
                `resource_metadata="${api}/.well-known/oauth-protected-resource/v1/mcp"`,
            );
        });

        it("rejects a GameNode-signed token for another audience", async () => {
            await post(
                initialize,
                await token({ aud: `${api}/something-else` }),
            ).expect(401);
        });

        it("rejects an expired token", async () => {
            const past = Math.floor(Date.now() / 1000) - 3600;
            await post(
                initialize,
                await token({ iat: past - 3600, exp: past }),
            ).expect(401);
        });

        it("rejects a token issued to a different issuer", async () => {
            await post(
                initialize,
                await token({ iss: "https://evil.example" }),
            ).expect(401);
        });

        it("rejects a token without an acting user", async () => {
            await post(initialize, await token({ sub: undefined })).expect(401);
        });

        it("initializes with a valid token", async () => {
            const response = await post(initialize, await token()).expect(200);
            expect(response.body.result.serverInfo.name).toBe("gamenode");
        });
    });

    describe("scopes and acting user", () => {
        it("refuses a tool call missing its scope with insufficient_scope, before running it", async () => {
            const response = await post(
                call("create_post", { game_id: 1, content: "hello" }),
                await token(),
            ).expect(403);
            expect(response.headers["www-authenticate"]).toContain(
                "insufficient_scope",
            );
            expect(response.headers["www-authenticate"]).toContain(
                'scope="posts:write"',
            );
            expect(tools.createPost).not.toHaveBeenCalled();
        });

        it("runs a tool as the token's sub when the scope is held", async () => {
            const response = await post(
                call("create_post", { game_id: 1, content: "hello" }),
                await token({}, "posts:write"),
            ).expect(200);
            expect(response.body.result.content[0].text).toBe("done");
            expect(tools.createPost).toHaveBeenCalledWith(userId, {
                game_id: 1,
                content: "hello",
            });
        });

        it("maps every tool to the scope in the spec", () => {
            expect(MCP_TOOL_SCOPES).toEqual({
                search_games: "games:read",
                get_game: "games:read",
                get_library_entry: "library:read",
                list_collections: "library:read",
                add_game_to_library: "library:write",
                review_game: "reviews:write",
                create_post: "posts:write",
                list_unmapped_games: "mappings:write",
                map_external_game: "mappings:write",
                dismiss_unmapped_game: "mappings:write",
            });
        });
    });

    describe("tools/list", () => {
        it("lists the seven regular tools with JSON Schemas and read-only hints", async () => {
            const response = await post(
                { jsonrpc: "2.0", id: 3, method: "tools/list" },
                await token(),
            ).expect(200);
            const listed: {
                name: string;
                inputSchema: { type: string };
                annotations: { readOnlyHint: boolean };
            }[] = response.body.result.tools;
            expect(listed.map((tool) => tool.name).sort()).toEqual(
                Object.keys(MCP_TOOL_SCOPES)
                    .filter((name) => !MAPPING_TOOLS.includes(name))
                    .sort(),
            );
            for (const tool of listed) {
                expect(tool.inputSchema.type).toBe("object");
                expect(tool.annotations.readOnlyHint).toBe(
                    [
                        "search_games",
                        "get_game",
                        "get_library_entry",
                        "list_collections",
                    ].includes(tool.name),
                );
            }
        });
    });

    describe("mapping tools", () => {
        const scope = "mappings:write";

        it("lists them for an admin alongside the regular tools", async () => {
            asRoles(["admin"]);
            const names = await listTools(await token({}, scope));
            expect(names.sort()).toEqual(Object.keys(MCP_TOOL_SCOPES).sort());
        });

        it("omits them for a user without the admin role, even with the scope", async () => {
            asRoles(["user", "mod"]);
            expect(await listTools(await token({}, scope))).not.toEqual(
                expect.arrayContaining(MAPPING_TOOLS),
            );
        });

        it("fails a non-admin call as an unknown tool and writes nothing", async () => {
            asRoles(["user"]);
            const response = await post(
                call("map_external_game", { id: 1, game_id: 2 }),
                await token({}, scope),
            ).expect(200);
            expect(
                response.body.error ?? response.body.result.isError,
            ).toBeTruthy();
            expect(tools.mapExternalGame).not.toHaveBeenCalled();
        });

        it("runs an admin call as the token's user", async () => {
            asRoles(["admin"]);
            await post(
                call("dismiss_unmapped_game", { id: 4 }),
                await token({}, scope),
            ).expect(200);
            expect(tools.dismissUnmappedGame).toHaveBeenCalledWith(userId, {
                id: 4,
            });
        });

        it("asks an admin whose token lacks the scope for mappings:write", async () => {
            asRoles(["admin"]);
            const response = await post(
                call("list_unmapped_games"),
                await token(),
            ).expect(403);
            expect(response.headers["www-authenticate"]).toContain(
                'scope="mappings:write"',
            );
        });

        it("stops listing them as soon as the role is revoked", async () => {
            const bearer = await token({}, scope);
            asRoles(["admin"]);
            expect(await listTools(bearer)).toEqual(
                expect.arrayContaining(MAPPING_TOOLS),
            );
            asRoles(["user"]);
            expect(await listTools(bearer)).not.toEqual(
                expect.arrayContaining(MAPPING_TOOLS),
            );
        });
    });

    describe("transport", () => {
        it.each(["get", "delete"] as const)(
            "answers %s with 405",
            async (method) => {
                await request(app.getHttpServer())
                    [method]("/v1/mcp")
                    .expect(405);
            },
        );
    });

    describe("input validation", () => {
        it.each([
            { query: "" },
            { query: "x".repeat(257) },
            { query: "game", limit: 0 },
            { query: "game", limit: 21 },
            { query: "game", page: 0 },
        ])("rejects out-of-bounds search input %j", async (input) => {
            const response = await post(
                call("search_games", input),
                await token(),
            ).expect(200);
            expect(response.body.result.isError).toBe(true);
            expect(tools.searchGames).not.toHaveBeenCalled();
        });

        it("defaults the search limit and accepts its upper bounds", async () => {
            const bearer = await token();
            await post(call("search_games", { query: "game" }), bearer).expect(
                200,
            );
            expect(tools.searchGames).toHaveBeenLastCalledWith({
                query: "game",
                limit: 10,
            });
            await post(
                call("search_games", { query: "x".repeat(256), limit: 20 }),
                bearer,
            ).expect(200);
            expect(tools.searchGames).toHaveBeenLastCalledWith({
                query: "x".repeat(256),
                limit: 20,
            });
        });

        it("never passes a client-supplied user id to a tool", async () => {
            await post(
                call("get_library_entry", { game_id: 1, user_id: "other" }),
                await token({}, "library:read"),
            ).expect(200);
            expect(tools.getLibraryEntry).toHaveBeenCalledWith(userId, {
                game_id: 1,
            });
        });

        it("returns a tool error naming the invalid field without running the tool", async () => {
            const response = await post(
                call("review_game", { game_id: 1, rating: 7 }),
                await token({}, "reviews:write"),
            ).expect(200);
            expect(response.body.result.isError).toBe(true);
            expect(response.body.result.content[0].text).toContain("rating");
            expect(tools.reviewGame).not.toHaveBeenCalled();
        });
    });
});
