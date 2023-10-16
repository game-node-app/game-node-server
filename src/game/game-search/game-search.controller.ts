import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { GameSearchService } from "./game-search.service";
import { ApiTags } from "@nestjs/swagger";
import { GameSearchRequestDto } from "./dto/game-search-request.dto";

@Controller("game/search")
@ApiTags("game")
export class GameSearchController {
    constructor(private readonly gameSearchService: GameSearchService) {}

    @Post()
    async search(@Body() dto: GameSearchRequestDto) {
        return await this.gameSearchService.search(dto);
    }
}
