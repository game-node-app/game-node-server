import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Put,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { AchievementsService } from "./achievements.service";
import { GetAchievementsRequestDto } from "./dto/get-achievements-request.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { GetObtainedAchievementRequestDto } from "./dto/obtained-achivement-request.dto";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { PaginatedAchievementsResponseDto } from "./dto/paginated-achievements-response.dto";
import { UpdateFeaturedObtainedAchievementDto } from "./dto/update-featured-obtained-achievement.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { AchievementGrantRequestDto } from "./dto/achievement-grant.dto";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";

@Controller("achievements")
@ApiTags("achievements")
@UseGuards(AuthGuard)
export class AchievementsController {
    constructor(private readonly achievementsService: AchievementsService) {}

    @Get()
    @Public()
    @UseInterceptors(PaginationInterceptor)
    @ApiResponse({
        status: 200,
        type: PaginatedAchievementsResponseDto,
    })
    public getAchievements(@Query() query: GetAchievementsRequestDto) {
        return this.achievementsService.getAchievements(query);
    }

    @Get("obtained/:id")
    @Public()
    public getObtainedAchievement(
        @Param("id") achievementId: string,
        @Query() queryDto: GetObtainedAchievementRequestDto,
    ) {
        return this.achievementsService.getObtainedAchievementByAchievementId(
            queryDto.targetUserId,
            achievementId,
        );
    }

    @Get("obtained")
    @Public()
    public getAllObtainedAchievements(
        @Query() queryDto: GetObtainedAchievementRequestDto,
    ) {
        return this.achievementsService.getObtainedAchievementsByUserId(
            queryDto,
        );
    }

    @Put("obtained/:id/featured")
    public updateFeaturedObtainedAchievement(
        @Session() session: SessionContainer,
        @Param("id") achievementId: string,
        @Body() dto: UpdateFeaturedObtainedAchievementDto,
    ) {
        return this.achievementsService.updateFeaturedObtainedAchievement(
            session.getUserId(),
            achievementId,
            dto,
        );
    }

    @Post("grant")
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    async grantAchievements(@Body() dto: AchievementGrantRequestDto) {
        return this.achievementsService.grantAchievements(
            dto.targetUserIds,
            dto.achievementId,
        );
    }
}
