import { Controller, Get } from "@nestjs/common";
import { StatisticsGameService } from "./statistics-game.service";
import { ApiTags } from "@nestjs/swagger";

@Controller("statistics/game")
@ApiTags("statistics-game")
export class StatisticsGameController {
    constructor(private readonly statisticsService: StatisticsGameService) {}

    @Get("trending")
    async trending() {
        return this.statisticsService.findTrending();
    }
}
