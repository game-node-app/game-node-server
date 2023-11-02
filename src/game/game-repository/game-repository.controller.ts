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
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import {
    ApiOkResponsePaginated,
    PaginationResponseDto,
} from "../../utils/pagination/pagination-response.dto";
import { Game } from "./entities/game.entity";

@Controller("game/repository")
@ApiTags("game-repository")
export class GameRepositoryController {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    @Post(":id")
    @HttpCode(200)
    async findOneById(
        @Param("id") id: number,
        @Body() dto?: GameRepositoryRequestDto,
    ) {
        return this.gameRepositoryService.findOneByIdWithDto(id, dto);
    }

    @Get()
    @UseInterceptors(PaginationInterceptor)
    @HttpCode(200)
    @ApiOkResponsePaginated(Game)
    async findAll() {
        return this.gameRepositoryService.findAll();
    }
}
