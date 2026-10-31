import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { McpToolsService } from "./mcp-tools.service";

const gameId = z.number().int().positive().describe("GameNode game id");
const WRITE_NOTE =
    " This changes or publishes data on the user's GameNode account; confirm with the user first.";

/**
 * A fresh server per request (stateless transport), acting as `userId`. No tool takes a user id as input.
 * Required scopes are enforced per tool in McpController via MCP_TOOL_SCOPES.
 */
export function createMcpServer(tools: McpToolsService, userId: string) {
    const server = new McpServer({ name: "gamenode", version: "1.0.0" });
    const read = { readOnlyHint: true };
    const write = { readOnlyHint: false, destructiveHint: false };

    server.registerTool(
        "search_games",
        {
            title: "Search games",
            description:
                "Search the GameNode catalog by title. Returns game ids, names, release years and platforms.",
            inputSchema: z.object({
                query: z.string().min(1).max(256),
                limit: z.number().int().min(1).max(20).default(10),
                page: z.number().int().min(1).optional(),
            }),
            annotations: read,
        },
        (input) => tools.searchGames(input),
    );

    server.registerTool(
        "get_game",
        {
            title: "Get game details",
            description:
                "Get a game's summary, genres, platforms (with ids for add_game_to_library), cover and GameNode review score.",
            inputSchema: z.object({ id: gameId }),
            annotations: read,
        },
        (input) => tools.getGame(input),
    );

    server.registerTool(
        "get_library_entry",
        {
            title: "Get library entry",
            description:
                "Get the user's library entry for a game (status, platforms, collections), or whether it is not in the library.",
            inputSchema: z.object({ game_id: gameId }),
            annotations: read,
        },
        (input) => tools.getLibraryEntry(userId, input),
    );

    server.registerTool(
        "list_collections",
        {
            title: "List collections",
            description:
                "List the user's collections (id, name, default status) to use as collection_ids in add_game_to_library.",
            inputSchema: z.object({}),
            annotations: read,
        },
        () => tools.listCollections(userId),
    );

    server.registerTool(
        "add_game_to_library",
        {
            title: "Add game to library",
            description:
                "Add a game to the user's library, or update its status, platforms and collections. Existing collections are kept." +
                WRITE_NOTE,
            inputSchema: z.object({
                game_id: gameId,
                status: z.enum(Object.values(CollectionEntryStatus)),
                platform_ids: z
                    .array(z.number().int().positive())
                    .min(1)
                    .max(50)
                    .optional()
                    .describe(
                        "Platforms the user owns the game on, from get_game. Required for a new entry.",
                    ),
                collection_ids: z
                    .array(z.string().min(1).max(64))
                    .max(50)
                    .optional()
                    .describe("Collections to add the game to"),
            }),
            annotations: write,
        },
        (input) => tools.addGameToLibrary(userId, input),
    );

    server.registerTool(
        "review_game",
        {
            title: "Review game",
            description:
                "Publish a review for a game that is in the user's library. If the user already reviewed it, nothing changes unless overwrite is true." +
                WRITE_NOTE,
            inputSchema: z.object({
                game_id: gameId,
                rating: z.number().min(0).max(5),
                content: z
                    .string()
                    .min(4)
                    .max(10_000)
                    .optional()
                    .describe("Plain text; blank lines separate paragraphs"),
                overwrite: z.boolean().default(false),
            }),
            annotations: write,
        },
        (input) => tools.reviewGame(userId, input),
    );

    server.registerTool(
        "create_post",
        {
            title: "Create post",
            description:
                "Publish a post about a game on the user's profile and feeds." +
                WRITE_NOTE,
            inputSchema: z.object({
                game_id: gameId,
                content: z
                    .string()
                    .min(1)
                    .max(5000)
                    .describe("Plain text; blank lines separate paragraphs"),
            }),
            annotations: write,
        },
        (input) => tools.createPost(userId, input),
    );

    return server;
}
