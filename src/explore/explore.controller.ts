import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    UseInterceptors,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExploreService } from "./explore.service";
import { GameRepositoryFilterDto } from "../game/game-repository/dto/game-repository-filter.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";

@Controller("explore")
@ApiTags("explore")
export class ExploreController {
    constructor(private exploreService: ExploreService) {}

    @Post("games")
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(PaginationInterceptor)
    async exploreGames(@Body() dto: GameRepositoryFilterDto) {
        return this.exploreService.findSortedGames(dto);
    }
}
