import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    UseInterceptors,
} from "@nestjs/common";
import {
    GameRepositoryService,
    TAllowedResource,
} from "./game-repository.service";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { GameRepositoryFindAllDto } from "./dto/game-repository-find-all.dto";
import { GameRepositoryPaginatedResponseDto } from "./dto/game-repository-paginated-response.dto";
import { GameRepositoryFindOneDto } from "./dto/game-repository-find-one.dto";

@Controller("game/repository")
@ApiTags("game-repository")
export class GameRepositoryController {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    @Get("resource")
    async getResource(@Query("resourceName") resourceName: TAllowedResource) {
        return await this.gameRepositoryService.getResource(resourceName);
    }

    @Post(":id")
    @HttpCode(200)
    async findOneById(
        @Param("id") id: number,
        @Body() dto?: GameRepositoryFindOneDto,
    ) {
        return this.gameRepositoryService.findOneById(id, dto);
    }

    @Post()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: GameRepositoryPaginatedResponseDto,
    })
    @HttpCode(200)
    async findAllByIds(@Body() dto: GameRepositoryFindAllDto) {
        return await this.gameRepositoryService.findAllByIds(dto);
    }
}
