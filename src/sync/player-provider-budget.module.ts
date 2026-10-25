import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import {
    PlayerProviderBudgetService,
    PLAYER_PROVIDER_BUDGET_QUEUE,
} from "./player-provider-budget.service";

@Module({
    imports: [BullModule.registerQueue({ name: PLAYER_PROVIDER_BUDGET_QUEUE })],
    providers: [PlayerProviderBudgetService],
})
export class PlayerProviderBudgetModule {}
