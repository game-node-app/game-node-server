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
import { GameRepositoryService } from "./game-repository.service";
import { GameRepositoryFindAllDto } from "./dto/game-repository-find-all.dto";
import { GameRepositoryFindOneDto } from "./dto/game-repository-find-one.dto";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { GameResource } from "./entities/base/game-resource.entity";
import {
    FindGamesByCollectionTypeRequestDto,
    FindGamesByCollectionTypeResponseDto,
    GameRepositoryCollectionType,
} from "./dto/game-repository-collection.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";

@Controller("game/repository")
@ApiTags("game-repository")
export class GameRepositoryController {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    @Get("resource")
    async getResource(@Query("resourceName") resourceName: string) {
        return await this.gameRepositoryService.getResource(
            resourceName as keyof GameResource,
        );
    }

    @Post("collection")
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindGamesByCollectionTypeResponseDto,
    })
    async getGameIdsByCollectionType(
        @Body() dto: FindGamesByCollectionTypeRequestDto,
    ) {
        return await this.gameRepositoryService.findGamesByCollectionType(dto);
    }

    @Get(":id/platforms/icon")
    @HttpCode(200)
    getIconNamesForPlatformAbbreviations(@Param("id") gameId: number) {
        return this.gameRepositoryService.getIconsNamesForPlatforms(gameId);
    }

    /**
     * TODO: Move this endpoint to {@link ExternalGameService}
     * @param gameId
     */
    @Get(":id/external-stores")
    @HttpCode(200)
    getExternalStoresForGameId(@Param("id") gameId: number) {
        return this.gameRepositoryService.findGameExternalStores(gameId);
    }

    @Post(":id")
    @HttpCode(200)
    async findOneById(
        @Param("id") id: number,
        @Body() dto?: GameRepositoryFindOneDto,
    ) {
        return this.gameRepositoryService.findOneByIdOrFail(id, dto);
    }

    @Post()
    @HttpCode(200)
    async findAllByIds(@Body() dto: GameRepositoryFindAllDto) {
        return await this.gameRepositoryService.findAllByIds(dto);
    }
}
