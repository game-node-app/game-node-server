import {
    Body,
    Controller,
    Get,
    Param,
    Put,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { UpdateFeaturedObtainedAchievementV2Dto } from "../dto/update-featured-obtained-achievement.dto";
import { AchievementsService } from "../achievements.service";
import { Public } from "../../auth/public.decorator";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { GetAchievementsV2RequestDto } from "../dto/get-achievements-request.dto";
import {
    AchievementEventsResponseDto,
    AchievementProgressDto,
    PaginatedAchievementsV2ResponseDto,
} from "../dto/achievement-v2.dto";

@Controller({
    path: "achievements",
    version: "2",
})
@ApiTags("achievements")
@UseGuards(AuthGuard)
export class AchievementsV2Controller {
    constructor(private readonly achievementsService: AchievementsService) {}

    @Get()
    @Public()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({ type: PaginatedAchievementsV2ResponseDto })
    getAchievements(@Query() query: GetAchievementsV2RequestDto) {
        return this.achievementsService.getAchievementsV2(query);
    }

    @Get("progress/:userId")
    @Public()
    @ApiOkResponse({ type: [AchievementProgressDto] })
    getProgress(@Param("userId") userId: string) {
        return this.achievementsService.getProgress(userId);
    }

    @Get("events")
    @Public()
    @ApiOkResponse({ type: AchievementEventsResponseDto })
    getEvents() {
        return this.achievementsService.getEvents();
    }

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
