import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { SupporterGuard } from "./supporter.guard";
import { SupporterSubscriptionStart } from "./entity/supporter-subscription-start.entity";
import { SupporterSubscriptionStartService } from "./supporter-subscription-start.service";

@Module({
    controllers: [BillingController],
    imports: [TypeOrmModule.forFeature([SupporterSubscriptionStart])],
    providers: [
        BillingService,
        SupporterGuard,
        SupporterSubscriptionStartService,
    ],
    exports: [
        BillingService,
        SupporterGuard,
        SupporterSubscriptionStartService,
    ],
})
export class BillingModule {}
