import { Module } from "@nestjs/common";
import { AwardsAdminService } from "./admin/awards-admin.service";
import { AwardsAdminController } from "./admin/awards-admin.controller";
import { AwardsService } from "./awards.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AwardsEvent } from "./entity/awards-event.entity";
import { AwardsCategory } from "./entity/awards-category.entity";
import { AwardsCategorySuggestion } from "./entity/awards-category-suggestion.entity";
import { AwardsVoteService } from "./vote/awards-vote.service";
import { AwardsVoteController } from "./vote/awards-vote.controller";
import { AwardsVote } from "./entity/awards-vote.entity";
import { AwardsController } from "./awards.controller";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { AwardsCategoryResult } from "./entity/awards-category-result.entity";
import { AwardsCategoryResultWinner } from "./entity/awards-category-winner.entity";
import { Game } from "../game/game-repository/entities/game.entity";
import { BullModule } from "@nestjs/bullmq";
import { AWARDS_RESULT_QUEUE_NAME } from "./result/constants";
import { AwardsResultQueue } from "./result/awards-result.queue";
import { AwardsResultProcessor } from "./result/awards-result.processor";
import { AwardsResultService } from "./result/awards-result.service";
import { AchievementsModule } from "../achievements/achievements.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            AwardsEvent,
            AwardsCategory,
            AwardsCategorySuggestion,
            AwardsVote,
            AwardsCategoryResult,
            AwardsCategoryResultWinner,
        ]),
        GameRepositoryModule,
        BullModule.registerQueue({
            name: AWARDS_RESULT_QUEUE_NAME,
        }),
        AchievementsModule,
    ],
    providers: [
        AwardsAdminService,
        AwardsService,
        AwardsVoteService,
        AwardsResultQueue,
        AwardsResultProcessor,
        AwardsResultService,
    ],
    controllers: [
        AwardsAdminController,
        AwardsVoteController,
        AwardsController,
    ],
})
export class AwardsModule {}
