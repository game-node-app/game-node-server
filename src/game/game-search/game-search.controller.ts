import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { GameSearchService } from "./game-search.service";
import { ApiTags } from "@nestjs/swagger";
import { GameSearchRequestDto } from "./dto/game-search-request.dto";
import { GameSearchResponseDto } from "./dto/game-search-response.dto";

@Controller("game/search")
@ApiTags("game-search")
export class GameSearchController {
    constructor(private readonly gameSearchService: GameSearchService) {}

    @Post()
    @HttpCode(200)
    async search(
        @Body() dto: GameSearchRequestDto,
    ): Promise<GameSearchResponseDto> {
        return await this.gameSearchService.search(dto);
    }
}
