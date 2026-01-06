import {
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
} from "@nestjs/websockets";
import { WebsocketGateway } from "../../utils/ws/WebsocketGateway";
import { PlaytimeWatchService } from "../../playtime/watch/playtime-watch.service";
import { EConnectionType } from "../connections.constants";
import { UseGuards } from "@nestjs/common";
import { WsAuthGuard } from "../../auth/ws-auth/WsAuthGuard";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { WsThrottlerGuard } from "../../utils/ws/WsThrottlerGuard";
import { seconds, Throttle } from "@nestjs/throttler";

@WebSocketGateway({
    namespace: "connection-sync",
    cors: {
        origin: "*",
    },
})
@UseGuards(WsAuthGuard)
@UseGuards(WsThrottlerGuard)
@Throttle({
    default: {
        limit: 10,
        ttl: seconds(60),
    },
})
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
