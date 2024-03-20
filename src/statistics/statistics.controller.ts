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
import { StatisticsService } from "./statistics.service";
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
import { days } from "@nestjs/throttler";

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(private readonly statisticsService: StatisticsService) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    @Public()
    async findOneBySourceIdAndType(@Body() dto: FindOneStatisticsDto) {
        return this.statisticsService.findOneBySourceIdAndType(
            dto.sourceId,
            dto.sourceType,
        );
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
        const result = (await this.statisticsService.findTrendingGames(
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
        return (await this.statisticsService.findTrendingReviews(
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
        return this.statisticsService.findStatus(
            dto.statisticsId,
            session?.getUserId(),
        );
    }
}
