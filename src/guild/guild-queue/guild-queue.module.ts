import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { GUILD_QUEUE_NAME } from "./guild-queue.constants";
import { GuildQueueService } from "./guild-queue.service";

@Module({
    imports: [BullModule.registerQueue({ name: GUILD_QUEUE_NAME })],
    providers: [GuildQueueService],
    exports: [GuildQueueService],
})
export class GuildQueueModule {}
