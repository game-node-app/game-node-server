import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConnectionProviderModule } from "../connection/connection-provider.module";
import {
    PlayerProviderBudgetService,
    PLAYER_PROVIDER_BUDGET_QUEUE,
} from "./player-provider-budget.service";

@Module({
    imports: [
        ConnectionProviderModule,
        BullModule.registerQueue({ name: PLAYER_PROVIDER_BUDGET_QUEUE }),
    ],
    providers: [PlayerProviderBudgetService],
    exports: [BullModule],
})
export class PlayerProviderBudgetModule {}
