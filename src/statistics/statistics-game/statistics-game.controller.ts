import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { StatisticsGameService } from "./statistics-game.service";
import { ApiTags } from "@nestjs/swagger";
import { FindTrendingStatisticsDto } from "./dto/find-trending-statistics-dto";

@Controller("statistics/game")
@ApiTags("statistics-game")
export class StatisticsGameController {
    constructor(private readonly statisticsService: StatisticsGameService) {}

    @Post("trending")
    async trending(@Body() dto?: FindTrendingStatisticsDto) {
        return this.statisticsService.findTrending(dto);
    }
}
