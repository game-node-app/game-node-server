import { CanActivate, ExecutionContext, Logger } from "@nestjs/common";
import { Socket } from "socket.io";
import { WsException } from "@nestjs/websockets";
import Session from "supertokens-node/recipe/session";

export class WebSocketAuthGuard implements CanActivate {
    private logger = new Logger(WebSocketAuthGuard.name);

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctxType = context.getType<"http" | "ws" | "rpc">();

        if (ctxType !== "ws") {
            throw new WsException(
                "WsAuthGuard can only be used in Websockets context.",
            );
        }

        const client: Socket = context.switchToWs().getClient();
        const token: string | undefined =
            client.handshake?.auth?.token || client.handshake?.query?.token;

        if (!token) {
            throw new WsException("Auth token not provided.");
        }

        try {
            // Adds session as a property so that it can be retrieved with @Session later.
            client.data.session =
                await Session.getSessionWithoutRequestResponse(token);
        } catch (err) {
            this.logger.error(err);
            throw new WsException(err.message);
        }

        return true;
    }
}
