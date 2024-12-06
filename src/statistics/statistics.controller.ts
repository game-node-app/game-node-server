import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpException,
    HttpStatus,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import {
    GameStatisticsPaginatedResponseDto,
    ReviewStatisticsPaginatedResponseDto,
} from "./dto/statistics-paginated-response.dto";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { StatisticsStatusRequestDto } from "./dto/statistics-status-request.dto";
import { FindStatisticsTrendingGamesDto } from "./dto/find-statistics-trending-games.dto";
import { FindStatisticsTrendingReviewsDto } from "./dto/find-statistics-trending-reviews.dto";
import { FindOneStatisticsDto } from "./dto/find-one-statistics.dto";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { GameStatisticsService } from "./game-statistics.service";
import { ReviewStatisticsService } from "./review-statistics.service";
import { StatisticsSourceType } from "./statistics.constants";
import { FindStatisticsTrendingActivitiesDto } from "./dto/find-statistics-trending-activities.dto";
import { ActivityStatisticsService } from "./activity-statistics.service";
import { CommentStatisticsService } from "./comment-statistics.service";

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(
        private readonly gameStatisticsService: GameStatisticsService,
        private readonly reviewStatisticsService: ReviewStatisticsService,
        private readonly activityStatisticsService: ActivityStatisticsService,
        private readonly commentStatisticsService: CommentStatisticsService,
    ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @Public()
    async findOneBySourceIdAndType(@Body() dto: FindOneStatisticsDto) {
        switch (dto.sourceType) {
            case StatisticsSourceType.GAME:
                return this.gameStatisticsService.findOne(
                    dto.sourceId as number,
                );
            case StatisticsSourceType.REVIEW:
                return this.reviewStatisticsService.findOne(
                    dto.sourceId as string,
                );
            case StatisticsSourceType.ACTIVITY:
                return this.activityStatisticsService.findOne(
                    dto.sourceId as string,
                );
            case StatisticsSourceType.ACTIVITY_COMMENT:
                return this.commentStatisticsService.findOne(
                    dto.sourceId as string,
                    StatisticsSourceType.ACTIVITY_COMMENT,
                );
            case StatisticsSourceType.REVIEW_COMMENT:
                return this.commentStatisticsService.findOne(
                    dto.sourceId as string,
                    StatisticsSourceType.REVIEW_COMMENT,
                );
            default:
                throw new HttpException(
                    "Invalid source type",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }

    @Post("trending/games")
    @Public()
    @UseInterceptors(PaginationInterceptor)
    @ApiResponse({
        status: 200,
        type: GameStatisticsPaginatedResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    async findTrendingGames(@Body() dto: FindStatisticsTrendingGamesDto) {
        console.time("trending/games");
        const result = (await this.gameStatisticsService.findTrending(
            dto,
        )) as unknown as GameStatisticsPaginatedResponseDto;
        console.timeEnd("trending/games");
        return result;
    }

    @Post("trending/reviews")
    @UseInterceptors(PaginationInterceptor)
    @UseInterceptors(CacheInterceptor)
    @CacheTTL(600)
    @ApiResponse({
        status: 200,
        type: ReviewStatisticsPaginatedResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    @Public()
    async findTrendingReviews(@Body() dto: FindStatisticsTrendingReviewsDto) {
        return (await this.reviewStatisticsService.findTrending(
            dto,
        )) as unknown as ReviewStatisticsPaginatedResponseDto;
    }

    @Post("trending/activities")
    @UseInterceptors(PaginationInterceptor)
    @UseInterceptors(CacheInterceptor)
    @CacheTTL(600)
    @ApiResponse({
        status: 200,
        type: ReviewStatisticsPaginatedResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    @Public()
    async findTrendingActivities(
        @Body() dto: FindStatisticsTrendingActivitiesDto,
    ) {
        return await this.activityStatisticsService.findTrending(dto);
    }

    @Get("status")
    @ApiResponse({
        status: 200,
        type: StatisticsStatus,
    })
    @Public()
    async getStatus(
        @Session() session: SessionContainer | undefined,
        @Query() dto: StatisticsStatusRequestDto,
    ) {
        switch (dto.sourceType) {
            case StatisticsSourceType.GAME:
                return this.gameStatisticsService.getStatus(
                    dto.statisticsId,
                    session?.getUserId(),
                );
            case StatisticsSourceType.REVIEW:
                return this.reviewStatisticsService.getStatus(
                    dto.statisticsId,
                    session?.getUserId(),
                );
            case StatisticsSourceType.ACTIVITY:
                return this.activityStatisticsService.getStatus(
                    dto.statisticsId,
                    session?.getUserId(),
                );
            case StatisticsSourceType.ACTIVITY_COMMENT:
                return this.commentStatisticsService.getStatus(
                    dto.statisticsId,
                    session?.getUserId(),
                );
            case StatisticsSourceType.REVIEW_COMMENT:
                return this.commentStatisticsService.getStatus(
                    dto.statisticsId,
                    session?.getUserId(),
                );
            default:
                throw new HttpException(
                    "Invalid source type",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }
}
