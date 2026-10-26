import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Put,
    Query,
    UseGuards,
    UseInterceptors,
    UsePipes,
    ValidationPipe,
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
import { SuspensionGuard } from "../suspension/suspension.guard";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
    ReactionRequestDto,
    ReactionResponseDto,
} from "./dto/reaction-request.dto";

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(
        private readonly statisticsService: StatisticsService,
        private readonly statisticsTrendingService: StatisticsTrendingService,
    ) {}

    @Put("like")
    @UseGuards(SuspensionGuard, ThrottlerGuard)
    @UsePipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    )
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        status: 200,
        type: ReactionResponseDto,
        description: "Applies a like reaction and returns current state and count.",
    })
    async addLike(
        @Session() session: SessionContainer,
        @Body() dto: ReactionRequestDto,
    ): Promise<ReactionResponseDto> {
        const userId = session.getUserId();
        return this.statisticsService.applyReaction(userId, dto, true);
    }

    @Delete("like")
    @UseGuards(SuspensionGuard, ThrottlerGuard)
    @UsePipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    )
    @HttpCode(HttpStatus.OK)
    @ApiResponse({
        status: 200,
        type: ReactionResponseDto,
        description: "Removes a like reaction and returns current state and count.",
    })
    async removeLike(
        @Session() session: SessionContainer,
        @Body() dto: ReactionRequestDto,
    ): Promise<ReactionResponseDto> {
        const userId = session.getUserId();
        return this.statisticsService.applyReaction(userId, dto, false);
    }

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
    async findTrendingReviews(
        @Session() session: SessionContainer | undefined,
        @Body() dto: FindStatisticsTrendingReviewsDto,
    ) {
        return (await this.statisticsTrendingService.findTrendingReviews(
            session?.getUserId(),
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
