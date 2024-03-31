import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
} from "@nestjs/common";
import {
    GameRepositoryService,
    TAllowedResource,
} from "./game-repository.service";
import { GameRepositoryFindAllDto } from "./dto/game-repository-find-all.dto";
import { GameRepositoryFindOneDto } from "./dto/game-repository-find-one.dto";
import { ApiTags } from "@nestjs/swagger";

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

    @Get(":id/platforms/icon")
    @HttpCode(200)
    getIconNamesForPlatformAbbreviations(@Param("id") gameId: number) {
        return this.gameRepositoryService.getIconsNamesForPlatforms(gameId);
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
    @HttpCode(200)
    async findAllByIds(@Body() dto: GameRepositoryFindAllDto) {
        return await this.gameRepositoryService.findAllByIds(dto);
    }
}
