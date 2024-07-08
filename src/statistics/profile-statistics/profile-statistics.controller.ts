import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ProfileStatisticsService } from "./profile-statistics.service";
import { ProfileStatisticsOverviewDto } from "./dto/profile-statistics-overview.dto";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import { ProfileStatisticsDistributionResponseDto } from "./dto/profile-statistics-distribution-request.dto";

@Controller("profile/statistics")
@ApiTags("profile-statistics")
@UseGuards(AuthGuard)
export class ProfileStatisticsController {
    constructor(
        private readonly profileStatisticsService: ProfileStatisticsService,
    ) {}

    /**
     * Retrieves basic stats for a user profile
     * @see
     */
    @Get("overview/:userId")
    @ApiOkResponse({
        type: ProfileStatisticsOverviewDto,
    })
    @Public()
    async getStatsOverview(@Param("userId") userId: string) {
        return this.profileStatisticsService.getStatsOverview(userId);
    }

    @Get("distribution/:userId")
    @ApiOkResponse({
        type: ProfileStatisticsDistributionResponseDto,
    })
    async getStatsDistribution(@Param("userId") userId: string) {
        return this.profileStatisticsService.getDistribution(userId);
    }
}
