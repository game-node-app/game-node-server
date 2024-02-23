import {
    Body,
    Controller,
    Get,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { StatisticsService } from "./statistics.service";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { StatisticsPaginatedResponseDto } from "./dto/statistics-paginated-response.dto";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { StatisticsStatusRequestDto } from "./dto/statistics-status-request.dto";
import { FindStatisticsTrendingGamesDto } from "./dto/find-statistics-trending-games.dto";
import { FindStatisticsTrendingReviewsDto } from "./dto/find-statistics-trending-reviews.dto";
import { FindOneStatisticsDto } from "./dto/find-one-statistics.dto";

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(private readonly statisticsService: StatisticsService) {}

    @Post()
    async findOneBySourceIdAndType(@Body() dto: FindOneStatisticsDto) {
        return this.statisticsService.findOneBySourceIdAndType(
            dto.sourceId,
            dto.sourceType,
        );
    }

    @Post("trending/games")
    @UseInterceptors(PaginationInterceptor)
    @UseInterceptors(CacheInterceptor)
    @ApiResponse({
        status: 200,
        type: StatisticsPaginatedResponseDto,
    })
    @CacheTTL(600)
    @Public()
    async findTrendingGames(@Body() dto: FindStatisticsTrendingGamesDto) {
        return (await this.statisticsService.findTrendingGames(
            dto,
        )) as unknown as StatisticsPaginatedResponseDto;
    }

    @Post("trending/reviews")
    @UseInterceptors(PaginationInterceptor)
    @UseInterceptors(CacheInterceptor)
    @ApiResponse({
        status: 200,
        type: StatisticsPaginatedResponseDto,
    })
    @CacheTTL(600)
    @Public()
    async findTrendingReviews(@Body() dto: FindStatisticsTrendingReviewsDto) {
        return (await this.statisticsService.findTrendingReviews(
            dto,
        )) as unknown as StatisticsPaginatedResponseDto;
    }

    @Get("status")
    @ApiResponse({
        status: 200,
        type: StatisticsStatus,
    })
    async getStatus(
        @Session() session: SessionContainer,
        @Query() dto: StatisticsStatusRequestDto,
    ) {
        return this.statisticsService.findStatus(
            dto.statisticsId,
            session?.getUserId(),
        );
    }
}
