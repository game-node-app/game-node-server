import { Injectable, Logger } from "@nestjs/common";
import {
    HLTBResponseItem,
    HLTBUpdateRequest,
    HLTBUpdateResponse,
} from "./hltb-sync.types";
import { DeepPartial } from "typeorm";
import { GamePlaytime } from "../../playtime/entity/game-playtime.entity";
import { AmqpConnection, RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import { PlaytimeService } from "../../playtime/playtime.service";

function parseResponse(
    gameId: number,
    item: HLTBResponseItem,
): DeepPartial<GamePlaytime> {
    return {
        gameId,
        sourceId: item.game_id,
        timeMain: item.comp_main,
        timePlus: item.comp_plus,
        time100: item.comp_100,
        timeAll: item.comp_all,
    };
}

@Injectable()
export class HltbSyncUpdateService {
    private logger = new Logger(HltbSyncUpdateService.name);

    constructor(
        private readonly amqpConnection: AmqpConnection,
        private readonly playtimeService: PlaytimeService,
    ) {}

    registerUpdateRequest(request: HLTBUpdateRequest) {
        if (
            request.gameId == undefined ||
            request.name == undefined ||
            request.name.trim().length === 0
        ) {
            this.logger.error(
                `Invalid update request received: must have a defined gameId and non-empty name: ${JSON.stringify(request)}`,
            );
            return;
        }

        this.amqpConnection
            .publish("sync-hltb", "sync.hltb.update.request", request)
            .then(() => {
                this.logger.log(
                    `Successfully sent update request for gameId: ${request.gameId}`,
                );
            })

            .catch((err) => {
                this.logger.error(
                    "Failed to send update request to hltb-sync!",
                );
                this.logger.error(err);
            });
    }

    /**
     * Do not call this method directly.
     */
    @RabbitSubscribe({
        exchange: "sync-hltb",
        routingKey: "sync.hltb.update.response",
        queue: "sync.hltb.update.response",
        name: "sync.hltb.update.response",
        allowNonJsonMessages: true,
    })
    async receiveUpdateResponse(msg: HLTBUpdateResponse) {
        this.logger.log(`Received update response for gameId: ${msg.gameId}`);
        const parsedResponse = parseResponse(msg.gameId, msg.match);
        await this.playtimeService.save(parsedResponse);
        this.logger.log(
            `Successfully processed update for gameId: ${msg.gameId}`,
        );
    }
}
