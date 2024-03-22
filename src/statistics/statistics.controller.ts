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
import { StatisticsPaginatedResponseDto } from "./dto/statistics-paginated-response.dto";
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

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(
        private readonly gameStatisticsService: GameStatisticsService,
        private readonly reviewStatisticsService: ReviewStatisticsService,
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
        type: StatisticsPaginatedResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    @Public()
    async findTrendingGames(@Body() dto: FindStatisticsTrendingGamesDto) {
        console.time("trending/games");
        const result = (await this.gameStatisticsService.findTrending(
            dto,
        )) as unknown as StatisticsPaginatedResponseDto;
        console.timeEnd("trending/games");
        return result;
    }

    @Post("trending/reviews")
    @UseInterceptors(PaginationInterceptor)
    @UseInterceptors(CacheInterceptor)
    @CacheTTL(600)
    @ApiResponse({
        status: 200,
        type: StatisticsPaginatedResponseDto,
    })
    @HttpCode(HttpStatus.OK)
    @Public()
    async findTrendingReviews(@Body() dto: FindStatisticsTrendingReviewsDto) {
        return (await this.reviewStatisticsService.findTrending(
            dto,
        )) as unknown as StatisticsPaginatedResponseDto;
    }

    @Get("status")
    @ApiResponse({
        status: 200,
        type: StatisticsStatus,
    })
    @Public()
    async getStatus(
        @Session() session: SessionContainer,
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
                    session.getUserId(),
                );
            default:
                throw new HttpException(
                    "Invalid source type",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }
}
