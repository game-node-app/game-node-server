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
import { ProfileMetricsReportResponseDto } from "./dto/profile-metrics-report.dto";
import { Period } from "../../utils/period";
import { ProfileMetricsReportService } from "./profile-metrics-report.service";
import { IsEnum } from "class-validator";
import {
    ProfileMetricsSummaryPeriod,
    ProfileMetricsSummaryResponseDto,
} from "./dto/profile-metrics-summary.dto";
import { ProfileMetricsSummaryService } from "./profile-metrics-summary.service";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { LibraryAccessService } from "../../libraries/library-access.service";
import {
    LibraryAudienceKey,
    resolveLibraryAudienceKey,
} from "./library-audience-key";

@Controller("profile/metrics")
@ApiTags("profile-metrics")
@UseGuards(AuthGuard)
export class ProfileMetricsController {
    constructor(
        private readonly profileMetricsService: ProfileMetricsService,
        private readonly profileMetricsDistributionService: ProfileMetricsDistributionService,
        private readonly profileMetricsReportService: ProfileMetricsReportService,
        private readonly profileMetricsSummaryService: ProfileMetricsSummaryService,
        private readonly libraryAccessService: LibraryAccessService,
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
    async getStatsOverview(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
    ) {
        return this.profileMetricsService.getStatsOverview(
            userId,
            session?.getUserId(),
        );
    }

    @Get("distribution/year/:userId")
    @ApiOkResponse({
        type: ProfileMetricsYearDistributionResponseDto,
    })
    @Public()
    async getYearDistribution(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
        @Query() dto: ProfileMetricsYearDistributionRequestDto,
    ) {
        return this.profileMetricsDistributionService.getYearDistribution(
            userId,
            dto,
            await this.libraryAccessService.resolve(
                session?.getUserId(),
                userId,
            ),
        );
    }

    @Get("report/:userId/:period")
    @ApiOkResponse({
        type: ProfileMetricsReportResponseDto,
    })
    @Public()
    async getPeriodReport(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
        @Param("period") period: Period.WEEK | Period.MONTH,
    ) {
        return this.profileMetricsReportService.generateReport(
            userId,
            period,
            await this.resolveAudience(session?.getUserId(), userId),
        );
    }

    /**
     * Playtime summary for the recap share card over a rolling week, month or
     * year, with the previous window of the same length for comparison.
     * Playtime is estimated from observed totals; `estimatedPlaytimeSeconds`
     * reports the part inferred from games' first observations.
     */
    @Get("summary/:userId/:period")
    @ApiOkResponse({
        type: ProfileMetricsSummaryResponseDto,
    })
    @Public()
    async getPeriodSummary(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
        @Param("period") period: ProfileMetricsSummaryPeriod,
    ) {
        return this.profileMetricsSummaryService.generateSummary(
            userId,
            period,
            await this.resolveAudience(session?.getUserId(), userId),
        );
    }

    @Get("distribution/type/:userId")
    @ApiOkResponse({
        type: ProfileMetricsTypeDistributionResponseDto,
    })
    @Public()
    async getTypeDistribution(
        @Session() session: SessionContainer | undefined,
        @Param("userId") userId: string,
        @Query() dto: ProfileMetricsTypeDistributionRequestDto,
    ) {
        return this.profileMetricsDistributionService.getTypeDistribution(
            userId,
            dto,
            await this.libraryAccessService.resolve(
                session?.getUserId(),
                userId,
            ),
        );
    }

    private async resolveAudience(
        viewerId: string | undefined,
        userId: string,
    ): Promise<LibraryAudienceKey> {
        const access = await this.libraryAccessService.resolve(
            viewerId,
            userId,
        );
        return resolveLibraryAudienceKey(
            this.libraryAccessService,
            userId,
            access,
        );
    }
}
