import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    WebSocketServer,
} from "@nestjs/websockets";
import { Socket } from "socket.io";
import Session from "supertokens-node/recipe/session";
import { Logger } from "@nestjs/common";

const getUserJoinKey = (userId: string) => `user:${userId}`;

export class WebsocketGateway implements OnGatewayConnection {
    protected readonly logger = new Logger(WebsocketGateway.name);

    @WebSocketServer()
    server: Socket;

    async getUserIdFromClient(client: Socket): Promise<string | null> {
        const token = client.handshake.query.token as string | undefined;
        if (!token) {
            return null;
        }

        try {
            const session =
                await Session.getSessionWithoutRequestResponse(token);
            return session.getUserId();
        } catch (err: unknown) {
            this.logger.error(err);
            return null;
        }
    }

    async handleConnection(client: Socket) {
        const userId = await this.getUserIdFromClient(client);
        if (!userId) {
            this.logger.warn(
                `Client ${client.id} failed to connect: auth fail`,
            );
            return null;
        }

        /**
         * Joins the client to a room named after their user ID,
         * which allows for all Socket.IO servers to connect to it.
         */
        this.server.join(getUserJoinKey(userId));
        this.logger.log(`Client ${userId} - ${client.id} connected`);
    }

    public sendMessageToUser(userId: string, message: string) {
        try {
            this.server.to(getUserJoinKey(userId)).emit("message", message);
        } catch (err) {
            this.logger.error(
                `Failed to send message to user ${userId}: ${err}`,
            );
        }
    }
}
