import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    UseInterceptors,
} from "@nestjs/common";
import { GameRepositoryRequestDto } from "./dto/game-repository-request.dto";
import { GameRepositoryService } from "./game-repository.service";
import { ApiTags } from "@nestjs/swagger";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { GameRepositoryPaginatedResponseDto } from "./dto/game-repository-paginated-response.dto";

@Controller("game/repository")
@ApiTags("game-repository")
export class GameRepositoryController {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    @Get("platforms")
    async findAllPlatforms() {
        return await this.gameRepositoryService.getAllGamePlatforms();
    }

    @Get("genres")
    async findAllGenres() {
        return await this.gameRepositoryService.getAllGenres();
    }

    @Get("themes")
    async findAllThemes() {
        return await this.gameRepositoryService.getAllThemes();
    }

    @Post(":id")
    @HttpCode(200)
    async findOneById(
        @Param("id") id: number,
        @Body() dto?: GameRepositoryRequestDto,
    ) {
        return this.gameRepositoryService.findOneByIdWithDto(id, dto);
    }
}
