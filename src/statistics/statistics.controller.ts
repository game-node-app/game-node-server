import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { StatisticsService } from "./statistics.service";
import { FindStatisticsDto } from "./dto/find-statistics.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { StatisticsInterceptor } from "./statistics.interceptor";
import { StatisticsPaginatedResponseDto } from "./dto/statistics-paginated-response.dto";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";

@Controller("statistics")
@ApiTags("statistics")
@UseInterceptors(CacheInterceptor)
export class StatisticsController {
    constructor(private readonly statisticsService: StatisticsService) {}

    /**
     * Trending refers to "popular in the last week/month
     */
    @Get("trending")
    @UseInterceptors(StatisticsInterceptor)
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: StatisticsPaginatedResponseDto,
    })
    @CacheTTL(600)
    async findTrending(@Query() dto: FindStatisticsDto) {
        return await this.statisticsService.findTrending(dto);
    }
}
