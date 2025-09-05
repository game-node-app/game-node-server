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

@Module({
    imports: [
        TypeOrmModule.forFeature([
            AwardsEvent,
            AwardsCategory,
            AwardsCategorySuggestion,
            AwardsVote,
        ]),
    ],
    providers: [AwardsAdminService, AwardsService, AwardsVoteService],
    controllers: [
        AwardsAdminController,
        AwardsVoteController,
        AwardsController,
    ],
})
export class AwardsModule {}
