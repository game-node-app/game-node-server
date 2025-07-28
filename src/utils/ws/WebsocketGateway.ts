import { OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import { Socket } from "socket.io";
import Session from "supertokens-node/recipe/session";

export class WebsocketGateway
    implements OnGatewayConnection, OnGatewayDisconnect
{
    /**
     * Active clients
     * @private
     */
    protected clients: Map<string, unknown> = new Map();

    async getUserIdFromClient(client: Socket): string | null {
        const token = client.handshake.query.token as string | undefined;
        if (!token) {
            return null;
        }

        const session = await Session.getSessionWithoutRequestResponse(token);

        return session.getUserId();
    }

    async handleConnection(client: Socket) {
        const userId = await this.getUserIdFromClient(client);
        if (!userId) {
            return null;
        }
    }
}
