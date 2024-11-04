import {
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { GameFilterService } from "./game-filter.service";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../../auth/auth.guard";
import { Roles } from "../../auth/roles.decorator";
import { EUserRoles } from "../../utils/constants";
import {
    FindAllExcludedGamesRequestDto,
    FindAllExcludedGamesResponseDto,
} from "./dto/find-all-excluded-games.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";

@Controller("game/filter")
@ApiTags("game-filter")
@UseGuards(AuthGuard)
@Roles([EUserRoles.ADMIN, EUserRoles.MOD])
export class GameFilterController {
    constructor(private readonly gameFilterService: GameFilterService) {}

    @Get()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindAllExcludedGamesResponseDto,
    })
    async findAll(@Query() dto: FindAllExcludedGamesRequestDto) {
        return this.gameFilterService.findAll(dto);
    }

    @Post(":gameId")
    @HttpCode(HttpStatus.CREATED)
    async registerExclusion(
        @Session() session: SessionContainer,
        @Param("gameId") gameId: number,
    ) {
        return this.gameFilterService.registerExclusion(
            session.getUserId(),
            gameId,
        );
    }

    @Delete(":gameId")
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteExclusion(
        @Session() session: SessionContainer,
        @Param("gameId") gameId: number,
    ) {
        return this.gameFilterService.deleteExclusion(gameId);
    }
}
