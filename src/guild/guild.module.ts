import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AchievementsModule } from "../achievements/achievements.module";
import { AchievementDefinition } from "../achievements/entities/achievement-definition.entity";
import { BillingModule } from "../billing/billing.module";
import { LevelModule } from "../level/level.module";
import { Profile } from "../profile/entities/profile.entity";
import { RecapModule } from "../recap/recap.module";
import { IgdbSyncModule } from "../sync/igdb/igdb-sync.module";
import { GUILD_ENTITIES } from "./entities";
import { GuildAccessGuard } from "./guild-access.guard";
import { GuildAccessService } from "./guild-access.service";
import { GuildAdminController } from "./guild-admin.controller";
import { GuildAdminService } from "./guild-admin.service";
import { GuildBoardService } from "./guild-board.service";
import { GuildContractEvaluatorProcessor } from "./guild-contract-evaluator.processor";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildContractRemindersService } from "./guild-contract-reminders.service";
import { GuildContractsService } from "./guild-contracts.service";
import { GuildController } from "./guild.controller";
import { GuildProfileService } from "./guild-profile.service";
import { GUILD_QUEUE_NAME } from "./guild-queue/guild-queue.constants";
import { GuildQueueModule } from "./guild-queue/guild-queue.module";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildScheduler } from "./guild.scheduler";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import { LinaReceptionService } from "./lina-reception.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            ...GUILD_ENTITIES,
            Profile,
            AchievementDefinition,
        ]),
        BullModule.registerQueue({ name: GUILD_QUEUE_NAME }),
        GuildQueueModule,
        IgdbSyncModule,
        RecapModule,
        BillingModule,
        LevelModule,
        AchievementsModule,
    ],
    controllers: [GuildController, GuildAdminController],
    providers: [
        GuildAccessService,
        GuildAccessGuard,
        GuildProfileService,
        LinaReceptionService,
        GuildTimeToBeatService,
        GuildBoardService,
        GuildRewardsService,
        GuildAdminService,
        GuildContractEvaluatorService,
        GuildContractEvaluatorProcessor,
        GuildContractRemindersService,
        GuildContractsService,
        GuildScheduler,
    ],
})
export class GuildModule {}
