import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Socket } from "socket.io";

@WebSocketGateway(undefined, {
    namespace: "connection-sync",
})
export class ConnectionSyncGateway {
    @WebSocketServer()
    private server: Socket;
}
