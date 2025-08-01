import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    WebSocketServer,
} from "@nestjs/websockets";
import { Socket } from "socket.io";
import Session from "supertokens-node/recipe/session";
import { Logger } from "@nestjs/common";

export class WebsocketGateway
    implements OnGatewayConnection, OnGatewayDisconnect
{
    protected readonly logger = new Logger(WebsocketGateway.name);
    @WebSocketServer()
    server: Socket;

    /**
     * Active clients mapping
     * @private
     */
    protected clients: Map<string, string> = new Map();

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

        this.clients.set(userId, client.id);
        this.logger.log(`Client ${userId} - ${client.id} connected`);
    }

    async handleDisconnect(client: Socket) {
        for (const [userId, clientId] of this.clients.entries()) {
            if (clientId === client.id) {
                this.clients.delete(userId);
                this.logger.log(`Client ${client.id} disconnected`);
            }
        }
    }

    public sendMessageToUser(userId: string, message: string) {
        const clientId = this.clients.get(userId);
        if (!clientId) {
            return;
        }

        this.server.to(clientId).emit("message", message);
    }
}
