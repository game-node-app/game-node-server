import {
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
} from "@nestjs/websockets";
import { WebsocketGateway } from "../../utils/ws/WebsocketGateway";
import { PlaytimeWatchService } from "../../playtime/watch/playtime-watch.service";
import { EConnectionType } from "../connections.constants";

@WebSocketGateway({
    namespace: "connection-sync",
    cors: {
        origin: "*",
    },
})
export class ConnectionSyncGateway extends WebsocketGateway {
    constructor(private readonly playtimeWatchService: PlaytimeWatchService) {
        super();
    }

    @SubscribeMessage("sync")
    public async performSync(
        @MessageBody()
        { userId, type }: { userId: string; type: EConnectionType },
    ) {
        await this.playtimeWatchService.registerJob(userId, type);
    }
}
