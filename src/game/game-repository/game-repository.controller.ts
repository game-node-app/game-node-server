import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { GameRepositoryRequestDto } from "./dto/game-repository-request.dto";
import { GameRepositoryService } from "./game-repository.service";
import { ApiTags } from "@nestjs/swagger";

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
}
