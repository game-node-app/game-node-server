import { Injectable, Logger } from "@nestjs/common";
import {
    AmqpConnection,
    RabbitRPC,
    RabbitSubscribe,
} from "@golevelup/nestjs-rabbitmq";

/**
 * Queue responsible for syncing games from IGDB (results already fetched) to our database.
 * This queue is used by the IGDB Sync service. It doesn't process the results on its own. <br><br>
 * See game-queue.processor.ts for processing logic.
 */
@Injectable()
export class IgdbSyncService {
    private logger = new Logger(IgdbSyncService.name);

    constructor(private amqp: AmqpConnection) {}

    @RabbitSubscribe({
        exchange: "sync",
        routingKey: "sync",
        queue: "sync",
        name: "sync",
        allowNonJsonMessages: true,
    })
    async handle2(msg: NonNullable<any[]>) {
        console.log(typeof msg, msg);
    }
}
