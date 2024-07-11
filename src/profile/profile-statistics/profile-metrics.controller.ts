import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ProfileMetricsService } from "./profile-metrics.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import {
    ProfileMetricsDistributionRequestDto,
    ProfileMetricsDistributionResponseDto,
} from "./dto/profile-metrics-distribution.dto";

@Controller("profile/metrics")
@ApiTags("profile-metrics")
@UseGuards(AuthGuard)
export class ProfileMetricsController {
    constructor(
        private readonly profileStatisticsService: ProfileMetricsService,
    ) {}

    /**
     * Retrieves basic stats for a user profile
     * @see
     */
    @Get("overview/:userId")
    @ApiOkResponse({
        type: ProfileMetricsOverviewDto,
    })
    @Public()
    async getStatsOverview(@Param("userId") userId: string) {
        return this.profileStatisticsService.getStatsOverview(userId);
    }

    @Get("distribution/:userId")
    @ApiOkResponse({
        type: ProfileMetricsDistributionResponseDto,
    })
    async getStatsDistribution(
        @Param("userId") userId: string,
        @Query() dto: ProfileMetricsDistributionRequestDto,
    ) {
        return this.profileStatisticsService.getDistribution(userId, dto);
    }
}
