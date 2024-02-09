import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";
import { AchievementsService } from "./achievements.service";
import { GetAchievementsRequestDto } from "./dto/get-achievements-request.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { GetObtainedAchievementRequestDto } from "./dto/obtained-achivement-request.dto";

@Controller("achievements")
export class AchievementsController {
    constructor(private readonly achievementsService: AchievementsService) {}

    @Get()
    @UseInterceptors(PaginationInterceptor)
    public getAchievements(@Query() query: GetAchievementsRequestDto) {
        return this.achievementsService.getAchievements(query);
    }

    @Get(":id")
    public getObtainedAchievement(
        @Query() queryDto: GetObtainedAchievementRequestDto,
    ) {
        return this.achievementsService.getObtainedAchievementById(
            queryDto.targetUserId,
            queryDto.achievementId,
        );
    }
}
