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
import { GamePlatform } from "./entities/game-platform.entity";

@Controller("game/repository")
@ApiTags("game-repository")
export class GameRepositoryController {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    @Get("platforms")
    async findAllPlatforms() {
        return await this.gameRepositoryService.findAllGamePlatforms();
    }

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
    async findAll(): Promise<GameRepositoryPaginatedResponseDto> {
        return (await this.gameRepositoryService.findAll()) as unknown as GameRepositoryPaginatedResponseDto;
    }
}
