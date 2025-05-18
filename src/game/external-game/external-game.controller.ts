import {
    Body,
    Controller,
    Get,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { ExternalGameService } from "./external-game.service";
import { Roles } from "../../auth/roles.decorator";
import { EUserRoles } from "../../utils/constants";
import { SubmitExternalGameDto } from "./dto/submit-external-game.dto";
import {
    FindExternalGamesRequestDto,
    FindExternalGamesResponseDto,
} from "./dto/find-external-games.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { ApiOkResponse } from "@nestjs/swagger";

@Controller("game/external")
@UseGuards(AuthGuard)
export class ExternalGameController {
    constructor(private readonly externalGameService: ExternalGameService) {}

    @Get()
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindExternalGamesResponseDto,
    })
    public async findAll(@Query() dto: FindExternalGamesRequestDto) {
        return (await this.externalGameService.findAll(
            dto,
        )) as unknown as FindExternalGamesResponseDto;
    }

    @Get("unmapped")
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    public async findUnmappedEntries() {
        return this.externalGameService.getUnmappedGames();
    }

    @Post()
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    public async submitExternalGame(@Body() dto: SubmitExternalGameDto) {
        return this.externalGameService.submit(dto);
    }
}
