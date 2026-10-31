import type { Express } from "express";
import { toNodeHandler } from "better-auth/node";
import { AuthService, MCP_PATH } from "./auth.service";

/**
 * Mounts Better Auth on the raw Express app, ahead of Nest's body parsers (it reads the raw body).
 */
export function mountAuth(server: Express, { auth }: AuthService) {
    const handler = toNodeHandler(auth);
    // Not app.use("/v1/auth"): Express strips mount prefixes, and Better Auth routes by full path.
    server.all("/v1/auth/*splat", handler);
    // RFC 8414 / 9728 put these at the host root with the issuer or resource path appended, which is
    // outside Better Auth's basePath. The oauth provider and mcp plugins answer them from onRequest.
    server.get(
        [
            "/.well-known/oauth-authorization-server/v1/auth",
            `/.well-known/oauth-protected-resource${MCP_PATH}`,
        ],
        handler,
    );
    // Some clients skip path insertion and ask for the bare path, so answer it as the issuer's.
    server.get("/.well-known/oauth-authorization-server", (req, res) => {
        req.url = "/.well-known/oauth-authorization-server/v1/auth";
        return handler(req, res);
    });
}
