import {
    Body,
    Controller,
    Get,
    HttpCode,
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
import { StatisticsService } from "./statistics.service";
import { AnyStatistics } from "./statistics.types";
import { StatisticsTrendingService } from "./statistics-trending.service";

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(
        private readonly statisticsService: StatisticsService,
        private readonly statisticsTrendingService: StatisticsTrendingService,
    ) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @Public()
    async findOneBySourceIdAndType(@Body() dto: FindOneStatisticsDto) {
        return this.statisticsService.findOne<AnyStatistics>(
            dto.sourceId,
            dto.sourceType,
        );
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
        const result = (await this.statisticsTrendingService.findTrendingGames(
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
        return (await this.statisticsTrendingService.findTrendingReviews(
            dto,
        )) as unknown as ReviewStatisticsPaginatedResponseDto;
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
        return this.statisticsService.getStatus(
            dto.statisticsId,
            dto.sourceType,
            session?.getUserId(),
        );
    }
}
