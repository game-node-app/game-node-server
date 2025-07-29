import {
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
} from "@nestjs/websockets";
import { WebsocketGateway } from "../../utils/ws/WebsocketGateway";
import { PlaytimeWatchService } from "../../playtime/watch/playtime-watch.service";
import { EConnectionType } from "../connections.constants";
import { UseGuards } from "@nestjs/common";
import { WebSocketAuthGuard } from "../../auth/ws-auth/WebSocketAuthGuard";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";

@WebSocketGateway({
    namespace: "connection-sync",
    cors: {
        origin: "*",
    },
})
@UseGuards(WebSocketAuthGuard)
export class ConnectionSyncGateway extends WebsocketGateway {
    constructor(private readonly playtimeWatchService: PlaytimeWatchService) {
        super();
    }

    @SubscribeMessage("sync")
    public async performSync(
        @Session() session: SessionContainer,
        @MessageBody("type") type: EConnectionType,
    ) {
        const userId = session.getUserId();
        await this.playtimeWatchService.registerJob(userId, type);
    }
}
