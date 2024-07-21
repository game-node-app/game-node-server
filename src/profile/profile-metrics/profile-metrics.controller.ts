import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ProfileMetricsService } from "./profile-metrics.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { AuthGuard } from "../../auth/auth.guard";
import { Public } from "../../auth/public.decorator";
import {
    ProfileMetricsYearDistributionRequestDto,
    ProfileMetricsYearDistributionResponseDto,
} from "./dto/profile-metrics-year-distribution.dto";
import { ProfileMetricsDistributionService } from "./profile-metrics-distribution.service";
import {
    ProfileMetricsTypeDistributionRequestDto,
    ProfileMetricsTypeDistributionResponseDto,
} from "./dto/profile-metrics-type-distribution.dto";
import { CacheInterceptor } from "@nestjs/cache-manager";

@Controller("profile/metrics")
@ApiTags("profile-metrics")
@UseGuards(AuthGuard)
export class ProfileMetricsController {
    constructor(
        private readonly profileMetricsService: ProfileMetricsService,
        private readonly profileMetricsDistributionService: ProfileMetricsDistributionService,
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
        return this.profileMetricsService.getStatsOverview(userId);
    }

    @Get("distribution/year/:userId")
    @ApiOkResponse({
        type: ProfileMetricsYearDistributionResponseDto,
    })
    @Public()
    async getYearDistribution(
        @Param("userId") userId: string,
        @Query() dto: ProfileMetricsYearDistributionRequestDto,
    ) {
        return this.profileMetricsDistributionService.getYearDistribution(
            userId,
            dto,
        );
    }

    @Get("distribution/type/:userId")
    @ApiOkResponse({
        type: ProfileMetricsTypeDistributionResponseDto,
    })
    @Public()
    async getTypeDistribution(
        @Param("userId") userId: string,
        @Query() dto: ProfileMetricsTypeDistributionRequestDto,
    ) {
        return this.profileMetricsDistributionService.getTypeDistribution(
            userId,
            dto,
        );
    }
}
