import { All, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createMcpProtectedRequestHandler } from "@better-auth/mcp";
import { fromNodeHeaders } from "better-auth/node";
import type {
    Request as ExpressRequest,
    Response as ExpressResponse,
} from "express";
import { AuthService } from "../auth/auth.service";
import { EUserRoles } from "../utils/constants";
import { MCP_PATH, MCP_TOOL_SCOPES } from "./mcp.constants";
import { createMcpServer } from "./mcp-tools";
import { McpToolsService } from "./mcp-tools.service";

/**
 * Stateless Streamable HTTP MCP endpoint at /v1/mcp, authenticated with the OAuth access tokens issued by
 * Better Auth's mcp() plugin (never with sessions).
 */
@Controller("mcp")
@ApiExcludeController()
export class McpController {
    private readonly resource: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly tools: McpToolsService,
        private readonly authService: AuthService,
    ) {
        this.resource = `${configService.getOrThrow<string>("DOMAIN_API")}${MCP_PATH}`;
    }

    @Post()
    @HttpCode(200)
    async handle(@Req() req: ExpressRequest, @Res() res: ExpressResponse) {
        // Scopes are checked here, per tool call, so a 403 insufficient_scope lets clients step up.
        const messages: { method?: string; params?: { name?: string } }[] =
            Array.isArray(req.body) ? req.body : [req.body];
        const requiredScopes = messages
            .filter((message) => message?.method === "tools/call")
            .map(
                (message) =>
                    Object.entries(MCP_TOOL_SCOPES).find(
                        ([name]) => name === message.params?.name,
                    )?.[1],
            )
            .filter((scope) => scope !== undefined);

        let userId: string | undefined;
        const denied = await createMcpProtectedRequestHandler(
            {
                issuer: `${this.configService.getOrThrow<string>("DOMAIN_API")}/v1/auth`,
                audience: this.resource,
                requiredScopes,
                jwtVerifyOptions: { requiredClaims: ["azp", "sub", "exp"] },
                // Loopback, not DOMAIN_API: verifying a token shouldn't leave the process's own host.
                jwksUrl: `http://127.0.0.1:${this.configService.get("SERVER_PORT") ?? 5000}/v1/auth/jwks`,
            },
            (_request, claims) => {
                userId = claims.sub;
                return new Response(null, { status: 204 });
            },
        )(
            new Request(this.resource, {
                method: "POST",
                headers: fromNodeHeaders(req.headers),
            }),
        );

        if (!userId) {
            res.status(denied.status);
            denied.headers.forEach((value, key) => res.setHeader(key, value));
            res.send(await denied.text());
            return;
        }

        // Read on every request, so revoking the role takes effect before the token expires.
        const isAdmin = (await this.authService.getUserRoles(userId)).includes(
            EUserRoles.ADMIN,
        );
        const server = createMcpServer(this.tools, userId, isAdmin);
        const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        res.on("close", () => {
            void transport.close();
            void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }

    // Stateless: there is no session to stream to or terminate. Declared after POST, which keeps priority.
    @All()
    notAllowed(@Res() res: ExpressResponse) {
        res.status(405).set("Allow", "POST").end();
    }
}
