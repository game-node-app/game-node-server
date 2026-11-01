export const MCP_PATH = "/v1/mcp";

/** Scope a token must hold to call each MCP tool; checked per `tools/call` in McpController. */
export const MCP_TOOL_SCOPES = {
    search_games: "games:read",
    get_game: "games:read",
    get_library_entry: "library:read",
    list_collections: "library:read",
    add_game_to_library: "library:write",
    review_game: "reviews:write",
    create_post: "posts:write",
    // Admin-only: also needs the ADMIN role, see createMcpServer.
    list_unmapped_games: "mappings:write",
    map_external_game: "mappings:write",
    dismiss_unmapped_game: "mappings:write",
} as const;

export const MCP_SCOPES = [
    "openid",
    "profile",
    "offline_access",
    ...new Set(Object.values(MCP_TOOL_SCOPES)),
];

export const MCP_WRITE_LIMIT = 10;
export const MCP_WRITE_WINDOW_MS = 60_000;
