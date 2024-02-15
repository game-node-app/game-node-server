import {
    Controller,
    Get,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { StatisticsService } from "./statistics.service";
import { FindStatisticsDto } from "./dto/find-statistics.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { StatisticsInterceptor } from "./statistics.interceptor";
import { StatisticsPaginatedResponseDto } from "./dto/statistics-paginated-response.dto";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { StatisticsActionDto } from "./statistics-queue/dto/statistics-action.dto";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(private readonly statisticsService: StatisticsService) {}

    /**
     * Trending refers to "popular in the last week/month
     */
    @Get("trending")
    @UseInterceptors(StatisticsInterceptor)
    @UseInterceptors(PaginationInterceptor)
    @UseInterceptors(CacheInterceptor)
    @ApiOkResponse({
        type: StatisticsPaginatedResponseDto,
    })
    @CacheTTL(600)
    @Public()
    async findTrending(@Query() dto: FindStatisticsDto) {
        return await this.statisticsService.findTrending(dto);
    }

    @Get()
    @UseInterceptors(StatisticsInterceptor)
    @Public()
    async findOne(
        @Query() dto: StatisticsActionDto,
        @Session() session?: SessionContainer,
    ) {
        return await this.statisticsService.findOne(dto, session?.getUserId());
    }
}
