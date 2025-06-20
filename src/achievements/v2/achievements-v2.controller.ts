import { Body, Controller, Put, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { ApiTags } from "@nestjs/swagger";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { UpdateFeaturedObtainedAchievementV2Dto } from "../dto/update-featured-obtained-achievement.dto";
import { AchievementsService } from "../achievements.service";

@Controller({
    path: "achievements",
    version: "2",
})
@ApiTags("achievements")
@UseGuards(AuthGuard)
export class AchievementsV2Controller {
    constructor(private readonly achievementsService: AchievementsService) {}

    @Put("obtained/featured")
    async updateFeaturedObtainedAchievements(
        @Session() session: SessionContainer,
        @Body() dto: UpdateFeaturedObtainedAchievementV2Dto,
    ) {
        return this.achievementsService.updateFeaturedObtainedAchievements(
            session.getUserId(),
            dto,
        );
    }
}
