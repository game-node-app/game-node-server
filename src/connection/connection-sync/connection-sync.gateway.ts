import {
    MessageBody,
    SubscribeMessage,
    WebSocketGateway,
    WsException,
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
        if (!Object.values(EConnectionType).includes(type))
            throw new WsException("Unsupported connection type");
        const userId = session.getUserId();
        return this.playtimeWatchService.registerJob(userId, type);
    }
    @SubscribeMessage("status")
    public async status(
        @Session() session: SessionContainer,
        @MessageBody("type") type: EConnectionType,
    ) {
        if (!Object.values(EConnectionType).includes(type))
            throw new WsException("Unsupported connection type");
        return this.playtimeWatchService.status(session.getUserId(), type);
    }
    @SubscribeMessage("achievement-status")
    public async achievementStatus(
        @Session() session: SessionContainer,
        @MessageBody("type") type: EConnectionType,
        @MessageBody("externalGameId") externalGameId: number,
    ) {
        if (
            !Object.values(EConnectionType).includes(type) ||
            !Number.isSafeInteger(externalGameId) ||
            externalGameId <= 0
        )
            throw new WsException("Invalid achievement synchronization target");
        return this.playtimeWatchService.gameStatus(
            session.getUserId(),
            type,
            externalGameId,
        );
    }
}
