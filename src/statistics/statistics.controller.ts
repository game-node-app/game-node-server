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
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { Session } from "../auth/session.decorator";
import { SuspensionGuard } from "../suspension/suspension.guard";
import { ThrottlerGuard } from "@nestjs/throttler";
import { StatisticsService } from "./statistics.service";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { ReactionRequestDto, ReactionResponseDto } from "./dto/reaction-request.dto";
import {
    StatisticsRankingsRequestDto,
    StatisticsRankingResponseDto,
    StatisticsSeriesRequestDto,
    StatisticsSeriesDto,
    StatisticsSourceRequestDto,
    StatisticsStatusDto,
    StatisticsSummaryDto,
    StatisticsViewRequestDto,
    StatisticsViewResponseDto,
} from "./dto/statistics-api.dto";

const strictValidation = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
});

@Controller("statistics")
@ApiTags("statistics")
@UseGuards(AuthGuard)
export class StatisticsController {
    constructor(
        private readonly statisticsService: StatisticsService,
        private readonly rankingService: StatisticsRankingService,
    ) {}

    @Put("like")
    @UseGuards(SuspensionGuard, ThrottlerGuard)
    @UsePipes(strictValidation)
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ status: 200, type: ReactionResponseDto })
    async addLike(@Session() session: SessionContainer, @Body() dto: ReactionRequestDto): Promise<ReactionResponseDto> {
        return this.statisticsService.applyReaction(session.getUserId(), dto, true);
    }

    @Delete("like")
    @UseGuards(SuspensionGuard, ThrottlerGuard)
    @UsePipes(strictValidation)
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ status: 200, type: ReactionResponseDto })
    async removeLike(@Session() session: SessionContainer, @Body() dto: ReactionRequestDto): Promise<ReactionResponseDto> {
        return this.statisticsService.applyReaction(session.getUserId(), dto, false);
    }

    @Post()
    @Public()
    @UsePipes(strictValidation)
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ status: 200, type: StatisticsSummaryDto })
    async findSummary(@Body() dto: StatisticsSourceRequestDto) {
        return this.statisticsService.findSummary(dto);
    }

    @Get("status")
    @Public()
    @UsePipes(strictValidation)
    @ApiResponse({ status: 200, type: StatisticsStatusDto })
    async getStatus(@Session() session: SessionContainer | undefined, @Query() dto: StatisticsSourceRequestDto) {
        return this.statisticsService.getStatus(dto, session?.getUserId());
    }

    @Post("series")
    @Public()
    @UsePipes(strictValidation)
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ status: 200, type: StatisticsSeriesDto })
    async findSeries(@Body() dto: StatisticsSeriesRequestDto) {
        return this.statisticsService.findSeries(dto);
    }

    @Post("rankings")
    @Public()
    @UsePipes(strictValidation)
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ status: 200, type: StatisticsRankingResponseDto })
    async findRankings(@Session() session: SessionContainer | undefined, @Body() dto: StatisticsRankingsRequestDto) {
        return this.rankingService.findRankings(session?.getUserId(), dto);
    }

    @Post("view")
    @Public()
    @UseGuards(SuspensionGuard, ThrottlerGuard)
    @UsePipes(strictValidation)
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiResponse({ status: 202, type: StatisticsViewResponseDto })
    async recordView(@Session() session: SessionContainer | undefined, @Body() dto: StatisticsViewRequestDto) {
        return this.statisticsService.recordView(session?.getUserId(), dto);
    }
}
